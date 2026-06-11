import { createFileRoute } from "@tanstack/react-router";

// Discord interaction types / response types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const UPDATE_MESSAGE = 7;
const EPHEMERAL = 1 << 6;

// Destination channels for moderation toggling
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
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signatureHex) as BufferSource,
      message as BufferSource,
    );
  } catch (e) {
    console.error("verify error", e);
    return false;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
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
  // In the accepted channel, allow Reject. In the rejected channel, allow Accept.
  if (status === "accepted") {
    return [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4, // red
            label: "Reject",
            custom_id: `reject:${id}`,
          },
        ],
      },
    ];
  }
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3, // green
          label: "Accept",
          custom_id: `approve:${id}`,
        },
      ],
    },
  ];
}

async function postToChannel(
  botToken: string,
  channelId: string,
  payload: unknown,
): Promise<string | null> {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    console.error("discord post failed", channelId, res.status, await res.text());
    return null;
  }
  const msg = (await res.json()) as { id: string };
  return msg.id;
}

export const Route = createFileRoute("/api/public/discord-interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env.DISCORD_PUBLIC_KEY;
        const botToken = process.env.DISCORD_BOT_TOKEN;
        if (!publicKey || !botToken)
          return new Response("Server misconfigured", { status: 500 });

        const signature = request.headers.get("x-signature-ed25519");
        const timestamp = request.headers.get("x-signature-timestamp");
        const body = await request.text();
        if (!signature || !timestamp) {
          return new Response("Missing signature", { status: 401 });
        }
        const valid = await verifySignature(publicKey, signature, timestamp, body);
        if (!valid) return new Response("Invalid signature", { status: 401 });

        const interaction = JSON.parse(body) as {
          type: number;
          data?: { custom_id?: string };
          member?: { user?: { id: string; username: string } };
          user?: { id: string; username: string };
        };

        if (interaction.type === PING) {
          return json({ type: PONG });
        }

        if (interaction.type === MESSAGE_COMPONENT) {
          const customId = interaction.data?.custom_id ?? "";
          const [action, submissionId] = customId.split(":");
          const moderator =
            interaction.member?.user ??
            interaction.user ?? { id: "unknown", username: "unknown" };

          if ((action !== "approve" && action !== "reject") || !submissionId) {
            return json({
              type: CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: "Invalid action.", flags: EPHEMERAL },
            });
          }

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data: sub, error: fetchErr } = await supabaseAdmin
            .from("submissions")
            .select("*")
            .eq("id", submissionId)
            .single();

          if (fetchErr || !sub) {
            return json({
              type: CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: "Submission not found.", flags: EPHEMERAL },
            });
          }

          const newStatus: "accepted" | "rejected" =
            action === "approve" ? "accepted" : "rejected";

          // Post new message to target channel with the opposite-action button
          const targetChannel =
            newStatus === "accepted" ? ACCEPTED_CHANNEL_ID : REJECTED_CHANNEL_ID;

          const newMessageId = await postToChannel(botToken, targetChannel, {
            embeds: [buildEmbed(sub as Submission, newStatus, moderator)],
            components: buildToggleComponents(newStatus, sub.id),
          });

          // Update DB: status, reviewed_at, and new message id (so future toggles target it)
          const { error: updErr } = await supabaseAdmin
            .from("submissions")
            .update({
              status: newStatus,
              reviewed_at: new Date().toISOString(),
              discord_message_id: newMessageId ?? sub.discord_message_id,
            })
            .eq("id", submissionId);

          if (updErr) {
            console.error("update error", updErr);
          }

          // Replace the original message: strip buttons, show audit trail.
          return json({
            type: UPDATE_MESSAGE,
            data: {
              content: `Moved to <#${targetChannel}> — ${newStatus} by <@${moderator.id}>`,
              embeds: [buildEmbed(sub as Submission, newStatus, moderator)],
              components: [],
            },
          });
        }

        if (interaction.type === APPLICATION_COMMAND) {
          return json({
            type: CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "No commands available.", flags: EPHEMERAL },
          });
        }

        return json({ error: "Unsupported interaction" }, 400);
      },
    },
  },
});
