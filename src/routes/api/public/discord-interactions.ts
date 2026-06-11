import { createFileRoute } from "@tanstack/react-router";
import { verifyAsync } from "@noble/ed25519";


const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const DEFERRED_UPDATE_MESSAGE = 6;
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
    return await verifyAsync(
      hexToBytes(signatureHex),
      message,
      hexToBytes(publicKeyHex),
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
  if (status === "accepted") {
    return [
      {
        type: 1,
        components: [
          { type: 2, style: 4, label: "Reject", custom_id: `reject:${id}` },
        ],
      },
    ];
  }
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Accept", custom_id: `approve:${id}` },
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

async function processToggle(params: {
  applicationId: string;
  botToken: string;
  interactionToken: string;
  submissionId: string;
  action: "approve" | "reject";
  moderator: { id: string; username: string };
}) {
  const { applicationId, botToken, interactionToken, submissionId, action, moderator } = params;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub, error: fetchErr } = await supabaseAdmin
      .from("submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (fetchErr || !sub) {
      await fetch(
        `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Submission not found.", components: [] }),
        },
      );
      return;
    }

    const newStatus: "accepted" | "rejected" =
      action === "approve" ? "accepted" : "rejected";
    const targetChannel =
      newStatus === "accepted" ? ACCEPTED_CHANNEL_ID : REJECTED_CHANNEL_ID;

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

    // Edit the original interaction message
    await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `Moved to <#${targetChannel}> — ${newStatus} by <@${moderator.id}>`,
          embeds: [buildEmbed(sub as Submission, newStatus, moderator)],
          components: [],
        }),
      },
    );
  } catch (e) {
    console.error("processToggle error", e);
  }
}

export const Route = createFileRoute("/api/public/discord-interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env.DISCORD_PUBLIC_KEY;
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const applicationId = process.env.DISCORD_APPLICATION_ID;
        if (!publicKey || !botToken || !applicationId)
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
          token: string;
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

          // Fire-and-forget the heavy work; ack immediately so Discord doesn't time out.
          void processToggle({
            applicationId,
            botToken,
            interactionToken: interaction.token,
            submissionId,
            action: action as "approve" | "reject",
            moderator,
          });

          return json({ type: DEFERRED_UPDATE_MESSAGE });
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
