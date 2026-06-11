import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SubmitSchema = z.object({
  username: z.string().trim().min(1).max(64),
  level: z.string().trim().min(1).max(128),
  level_path: z.string().trim().min(1).max(256),
  record_link: z.string().trim().url().max(500),
  raw_link: z.string().trim().url().max(500),
  notes: z.string().trim().max(2000).optional().nullable(),
  platform: z.enum(["Mobile", "PC"]),
  hz: z.number().int().min(1).max(1000),
});

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const Route = createFileRoute("/api/public/submit")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: cors,
          });
        }
        const parsed = SubmitSchema.safeParse(body);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "Invalid input", details: parsed.error.flatten() }),
            { status: 400, headers: cors },
          );
        }
        const data = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: inserted, error } = await supabaseAdmin
          .from("submissions")
          .insert({
            username: data.username,
            level: data.level,
            level_path: data.level_path,
            record_link: data.record_link,
            raw_link: data.raw_link,
            notes: data.notes ?? null,
            platform: data.platform,
            hz: data.hz,
            status: "pending",
          })
          .select("id")
          .single();

        if (error || !inserted) {
          console.error("submission insert error", error);
          return new Response(JSON.stringify({ error: "Failed to save submission" }), {
            status: 500,
            headers: cors,
          });
        }

        // Send a Bot message with Accept / Reject buttons
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const channelId = process.env.DISCORD_CHANNEL_ID;
        if (botToken && channelId) {
          try {
            const res = await fetch(
              `https://discord.com/api/v10/channels/${channelId}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bot ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  embeds: [
                    {
                      title: "New Record Submission (pending)",
                      color: 3447003,
                      fields: [
                        { name: "Username", value: data.username, inline: true },
                        { name: "Platform", value: data.platform, inline: true },
                        { name: "Hz", value: `${data.hz}`, inline: true },
                        { name: "Level", value: data.level },
                        { name: "Record Link", value: data.record_link },
                        { name: "Raw Footage", value: data.raw_link },
                        { name: "Notes", value: data.notes || "N/A" },
                      ],
                      footer: { text: `ID: ${inserted.id}` },
                    },
                  ],
                  components: [
                    {
                      type: 1,
                      components: [
                        {
                          type: 2,
                          style: 3, // green
                          label: "Accept",
                          custom_id: `approve:${inserted.id}`,
                        },
                        {
                          type: 2,
                          style: 4, // red
                          label: "Reject",
                          custom_id: `reject:${inserted.id}`,
                        },
                      ],
                    },
                  ],
                }),
              },
            );
            if (res.ok) {
              const msg = (await res.json()) as { id: string };
              await supabaseAdmin
                .from("submissions")
                .update({ discord_message_id: msg.id })
                .eq("id", inserted.id);
            } else {
              console.error("discord bot post failed", res.status, await res.text());
            }
          } catch (e) {
            console.error("discord bot post error", e);
          }
        }

        return new Response(JSON.stringify({ ok: true, id: inserted.id }), {
          status: 200,
          headers: cors,
        });
      },
    },
  },
});
