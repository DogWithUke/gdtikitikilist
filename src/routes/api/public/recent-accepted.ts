import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/recent-accepted")({
  server: {
    handlers: {
      GET: async () => {
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("submissions")
          .select("id, username, level, level_path, record_link, hz, reviewed_at")
          .eq("status", "accepted")
          .order("reviewed_at", { ascending: false })
          .limit(25);
        if (error) {
          console.error("recent-accepted error", error);
          return new Response(JSON.stringify({ records: [] }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ records: data ?? [] }), { status: 200, headers });
      },
    },
  },
});
