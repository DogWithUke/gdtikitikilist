import { createFileRoute } from "@tanstack/react-router";
import { verifyAsync } from "@noble/ed25519";

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const UPDATE_MESSAGE = 7;
const EPHEMERAL = 1 << 6;

const ACCEPTED_CHANNEL_ID = "1514190580450725890";
const REJECTED_CHANNEL_ID = "1514207386510819328";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function verifySignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  try {
    const message = new TextEncoder().encode(timestamp + body);
    return await verifyAsync(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
  } catch (e) {
    console.error("verify error", e);
    return false;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function ephemeralMessage(content: string): Response {
  return json({
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  });
}

type Submission = {
  id: string;
  username: string;
  level: string;
  level_path: string;
  record_link: string;
  raw_link: string;
  notes: string | null;
  platform: string;
  status: string;
  discord_message_id: string | null;
};

function buildEmbed(
  sub: Submission,
  status: "accepted" | "rejected",
  moderator: { id: string; username: string },
) {
  const color = status === "accepted" ? 5763719 : 15548997;
  const verb = status === "accepted" ? "Accepted" : "Rejected";
  return {
    title: `Record Submission — ${verb}`,
    color,
    fields: [
      { name: "Username", value: sub.username, inline: true },
      { name: "Platform", value: sub.platform, inline: true },
      { name: "Level", value: sub.level },
      { name: "Record Link", value: sub.record_link },
      { name: "Raw Footage", value: sub.raw_link },
      { name: "Notes", value: sub.notes || "N/A" },
      {
        name: `${verb} by`,
        value: `<@${moderator.id}> (${moderator.username})`,
      },
    ],
    footer: { text: `ID: ${sub.id}` },
    timestamp: new Date().toISOString(),
  };
}

function buildToggleComponents(status: "accepted" | "rejected", id: string) {
  if (status === "accepted") {
    return [
      {
        type: 1,
        components: [{ type: 2, style: 4, label: "Reject", custom_id: `reject:${id}` }],
      },
    ];
  }
  return [
    {
      type: 1,
      components: [{ type: 2, style: 3, label: "Accept", custom_id: `approve:${id}` }],
    },
  ];
}

async function postToChannel(
  botToken: string,
  channelId: string,
  payload: unknown,
): Promise<string | null> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error("discord post failed", channelId, res.status, errorText);
    throw new Error(`Discord post failed with status ${res.status}`);
  }
  const msg = (await res.json()) as { id: string };
  return msg.id;
}

async function processToggle(params: {
  botToken: string;
  submissionId: string;
  action: "approve" | "reject";
  moderator: { id: string; username: string };
}) {
  const { botToken, submissionId, action, moderator } = params;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub, error: fetchErr } = await supabaseAdmin
      .from("submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (fetchErr || !sub) {
      return {
        type: CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Submission not found.", flags: EPHEMERAL },
      };
    }

    const newStatus: "accepted" | "rejected" = action === "approve" ? "accepted" : "rejected";
    const targetChannel = newStatus === "accepted" ? ACCEPTED_CHANNEL_ID : REJECTED_CHANNEL_ID;

    const newMessageId = await postToChannel(botToken, targetChannel, {
      embeds: [buildEmbed(sub as Submission, newStatus, moderator)],
      components: buildToggleComponents(newStatus, sub.id),
    });

    await supabaseAdmin
      .from("submissions")
      .update({
        status: newStatus,
        reviewed_at: new Date().toISOString(),
        discord_message_id: newMessageId ?? sub.discord_message_id,
      })
      .eq("id", submissionId);

    return {
      type: UPDATE_MESSAGE,
      data: {
        content: `Moved to <#${targetChannel}> — ${newStatus} by <@${moderator.id}>`,
        embeds: [buildEmbed(sub as Submission, newStatus, moderator)],
        components: [],
      },
    };
  } catch (e) {
    console.error("processToggle error", e);
    return {
      type: CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "Could not update this submission. Please try again.",
        flags: EPHEMERAL,
      },
    };
  }
}

export const Route = createFileRoute("/api/public/discord-interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env.DISCORD_PUBLIC_KEY;
        if (!publicKey) {
          console.error("discord interactions missing DISCORD_PUBLIC_KEY");
          return new Response("Server misconfigured", { status: 500 });
        }

        const signature = request.headers.get("x-signature-ed25519");
        const timestamp = request.headers.get("x-signature-timestamp");
        const body = await request.text();
        if (!signature || !timestamp) {
          return new Response("Missing signature", { status: 401 });
        }
        const valid = await verifySignature(publicKey, signature, timestamp, body);
        if (!valid) {
          console.error("discord interactions invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }

        let interaction: {
          type: number;
          application_id?: string;
          token: string;
          data?: {
            custom_id?: string;
            name?: string;
            options?: Array<{ name: string; value: string }>;
          };
          member?: { user?: { id: string; username: string } };
          user?: { id: string; username: string };
        };
        try {
          interaction = JSON.parse(body);
        } catch (e) {
          console.error("discord interactions invalid json", e);
          return new Response("Invalid JSON", { status: 400 });
        }

        if (interaction.type === PING) {
          return json({ type: PONG });
        }

        if (interaction.type === MESSAGE_COMPONENT) {
          const customId = interaction.data?.custom_id ?? "";
          const [action, submissionId] = customId.split(":");
          const moderator = interaction.member?.user ??
            interaction.user ?? { id: "unknown", username: "unknown" };

          if ((action !== "approve" && action !== "reject") || !submissionId) {
            return ephemeralMessage("Invalid action.");
          }

          const botToken = process.env.DISCORD_BOT_TOKEN;

          if (!botToken) {
            console.error("discord interactions missing follow-up config", {
              hasBotToken: Boolean(botToken),
            });
            return ephemeralMessage("Bot moderation is not configured yet.");
          }

          const responsePayload = await processToggle({
            botToken,
            submissionId,
            action: action as "approve" | "reject",
            moderator,
          });

          return json(responsePayload);
        }

        if (interaction.type === APPLICATION_COMMAND) {
          const cmd = interaction.data?.name;
          const opts = interaction.data?.options ?? [];
          const username = opts.find((o) => o.name === "username")?.value?.trim();

          if (cmd === "delete_record") {
            const level = opts.find((o) => o.name === "level")?.value?.trim();
            if (!username || !level) {
              return ephemeralMessage("Usage: /delete_record username:<user> level:<level>");
            }
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: matches, error: selErr } = await supabaseAdmin
                .from("submissions")
                .select("id, username, level")
                .ilike("username", username)
                .ilike("level", level);
              if (selErr) throw selErr;
              if (!matches || matches.length === 0) {
                return ephemeralMessage(
                  `No records found for **${username}** on **${level}**.`,
                );
              }
              const ids = matches.map((m) => m.id);
              const { error: delErr } = await supabaseAdmin
                .from("submissions")
                .delete()
                .in("id", ids);
              if (delErr) throw delErr;
              return ephemeralMessage(
                `Deleted ${matches.length} record(s) for **${matches[0].username}** on **${matches[0].level}**.`,
              );
            } catch (e) {
              console.error("delete_record failed", e);
              return ephemeralMessage("Could not delete record. Try again.");
            }
          }

          if (cmd === "wipe_user") {
            if (!username) {
              return ephemeralMessage("Usage: /wipe_user username:<user>");
            }
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: matches, error: selErr } = await supabaseAdmin
                .from("submissions")
                .select("id, username")
                .ilike("username", username);
              if (selErr) throw selErr;
              if (!matches || matches.length === 0) {
                return ephemeralMessage(`No records found for **${username}**.`);
              }
              const ids = matches.map((m) => m.id);
              const { error: delErr } = await supabaseAdmin
                .from("submissions")
                .delete()
                .in("id", ids);
              if (delErr) throw delErr;
              return ephemeralMessage(
                `Wiped ${matches.length} record(s) for **${matches[0].username}**.`,
              );
            } catch (e) {
              console.error("wipe_user failed", e);
              return ephemeralMessage("Could not wipe records. Try again.");
            }
          }

          return ephemeralMessage("Unknown command.");
        }

        return json({ error: "Unsupported interaction" }, 400);
      },
    },
  },
});
