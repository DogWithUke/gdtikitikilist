import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/changelog")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("level_changelog")
          .select("*")
          .order("occurred_at", { ascending: false })
          .limit(200);
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        if (error) {
          console.error("changelog fetch error", error);
          return new Response(JSON.stringify({ events: [] }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ events: data ?? [] }), { status: 200, headers });
      },
    },
  },
});
