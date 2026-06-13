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

          if (cmd === "add_level") {
            const getOpt = (n: string) => opts.find((o) => o.name === n)?.value;
            const position = Number(getOpt("position"));
            const name = String(getOpt("name") ?? "").trim();
            const levelId = String(getOpt("level_id") ?? "").trim();
            const points = Number(getOpt("points"));
            const verifier = String(getOpt("verifier") ?? "").trim();
            const creatorsRaw = String(getOpt("creators") ?? "").trim();
            const publisher = String(getOpt("publisher") ?? "").trim() || null;
            const password = String(getOpt("password") ?? "").trim() || null;
            const verification = String(getOpt("verification") ?? "").trim() || null;
            const recordsRaw = String(getOpt("records") ?? "").trim();

            if (!position || !name || !levelId || !verifier || isNaN(points)) {
              return ephemeralMessage(
                "Usage: /add_level position:<#> name:<name> level_id:<id> points:<n> verifier:<user> creators:<a,b> [publisher] [password] [verification] [records:user|link|hz,user|link|hz]",
              );
            }

            const creators = creatorsRaw
              ? creatorsRaw.split(",").map((s) => s.trim()).filter(Boolean)
              : [];

            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: inserted, error: insErr } = await supabaseAdmin
                .from("custom_levels")
                .insert({
                  position,
                  name,
                  level_id: levelId,
                  password,
                  creators,
                  verifier,
                  publisher,
                  points,
                  verification,
                })
                .select("id")
                .single();
              if (insErr) throw insErr;

              await supabaseAdmin.from("level_changelog").insert({
                event_type: "added",
                level_name: name,
                position,
                details: { verifier, points, displaces_from: position },
              });

              // Optional bulk records: "user|link|hz,user|link|hz"
              if (recordsRaw && inserted) {
                const levelPath = `custom:${inserted.id}`;
                type RecRow = {
                  username: string;
                  level: string;
                  level_path: string;
                  record_link: string;
                  raw_link: string;
                  platform: string;
                  hz: number | null;
                  status: string;
                  reviewed_at: string;
                };
                const recRows = recordsRaw
                  .split(",")
                  .map((chunk): RecRow | null => {
                    const [user, link, hz] = chunk.split("|").map((s) => s.trim());
                    if (!user || !link) return null;
                    return {
                      username: user,
                      level: name,
                      level_path: levelPath,
                      record_link: link,
                      raw_link: link,
                      platform: "unknown",
                      hz: hz ? Number(hz) : null,
                      status: "accepted",
                      reviewed_at: new Date().toISOString(),
                    };
                  })
                  .filter((r): r is RecRow => r !== null);
                if (recRows.length > 0) {
                  const { error: recErr } = await supabaseAdmin
                    .from("submissions")
                    .insert(recRows);
                  if (recErr) console.error("add_level records insert failed", recErr);
                }
              }

              return ephemeralMessage(
                `Added **${name}** at #${position} — ${points} pts, verified by ${verifier}.`,
              );
            } catch (e) {
              console.error("add_level failed", e);
              return ephemeralMessage("Could not add level. Try again.");
            }
          }

          if (cmd === "delete_level") {
            const name = String(opts.find((o) => o.name === "name")?.value ?? "").trim();
            const position = opts.find((o) => o.name === "position")?.value;
            if (!name && position === undefined) {
              return ephemeralMessage("Usage: /delete_level name:<name> OR position:<#>");
            }
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              let q = supabaseAdmin
                .from("custom_levels")
                .select("id, name, position")
                .is("deleted_at", null);
              if (name) q = q.ilike("name", name);
              if (position !== undefined) q = q.eq("position", Number(position));
              const { data: matches, error: selErr } = await q;
              if (selErr) throw selErr;

              if (matches && matches.length > 0) {
                const ids = matches.map((m) => m.id);
                const { error: delErr } = await supabaseAdmin
                  .from("custom_levels")
                  .update({ deleted_at: new Date().toISOString() })
                  .in("id", ids);
                if (delErr) throw delErr;
                await supabaseAdmin.from("level_changelog").insert(
                  matches.map((m) => ({
                    event_type: "deleted",
                    level_name: m.name,
                    position: m.position,
                    details: { source: "custom" },
                  })),
                );
                return ephemeralMessage(
                  `Deleted ${matches.length} custom level(s): ${matches.map((m) => `#${m.position} ${m.name}`).join(", ")}. Use /restore_level to undo.`,
                );
              }

              // Fallback: hide a built-in (file-based) list level by name
              if (!name) {
                return ephemeralMessage(
                  "No matching custom level found. To hide a built-in level, provide name:<level name>.",
                );
              }
              const { error: hideErr } = await supabaseAdmin
                .from("hidden_levels")
                .upsert({ name }, { onConflict: "name" });
              if (hideErr) throw hideErr;
              await supabaseAdmin.from("level_changelog").insert({
                event_type: "deleted",
                level_name: name,
                position: position !== undefined ? Number(position) : null,
                details: { source: "builtin" },
              });
              return ephemeralMessage(
                `Hidden built-in level **${name}** from the list. Use \`/restore_level name:${name}\` to undo.`,
              );
            } catch (e) {
              console.error("delete_level failed", e);
              return ephemeralMessage("Could not delete level. Try again.");
            }
          }

          if (cmd === "restore_level") {
            const name = String(opts.find((o) => o.name === "name")?.value ?? "").trim();
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

              // First try hidden built-in levels by name
              if (name) {
                const { data: hidden } = await supabaseAdmin
                  .from("hidden_levels")
                  .select("id, name")
                  .ilike("name", name);
                if (hidden && hidden.length > 0) {
                  const { error: delErr } = await supabaseAdmin
                    .from("hidden_levels")
                    .delete()
                    .in("id", hidden.map((h) => h.id));
                  if (delErr) throw delErr;
                  await supabaseAdmin.from("level_changelog").insert(
                    hidden.map((h) => ({
                      event_type: "restored",
                      level_name: h.name,
                      details: { source: "builtin" },
                    })),
                  );
                  return ephemeralMessage(
                    `Restored built-in level(s): ${hidden.map((h) => h.name).join(", ")}.`,
                  );
                }
              }

              let q = supabaseAdmin
                .from("custom_levels")
                .select("id, name, position, deleted_at")
                .not("deleted_at", "is", null)
                .order("deleted_at", { ascending: false });
              if (name) q = q.ilike("name", name);
              else q = q.limit(1);
              const { data: matches, error: selErr } = await q;
              if (selErr) throw selErr;
              if (!matches || matches.length === 0) {
                return ephemeralMessage("No deleted levels to restore.");
              }
              const ids = matches.map((m) => m.id);
              const { error: updErr } = await supabaseAdmin
                .from("custom_levels")
                .update({ deleted_at: null })
                .in("id", ids);
              if (updErr) throw updErr;
              await supabaseAdmin.from("level_changelog").insert(
                matches.map((m) => ({
                  event_type: "restored",
                  level_name: m.name,
                  position: m.position,
                  details: { source: "custom" },
                })),
              );
              return ephemeralMessage(
                `Restored ${matches.length} level(s): ${matches.map((m) => `#${m.position} ${m.name}`).join(", ")}.`,
              );
            } catch (e) {
              console.error("restore_level failed", e);
              return ephemeralMessage("Could not restore level. Try again.");
            }
          }

          return ephemeralMessage("Unknown command.");
        }



        return json({ error: "Unsupported interaction" }, 400);
      },
    },
  },
});
