import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/records")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("submissions")
          .select("id, username, level, level_path, record_link, hz, reviewed_at")
          .eq("status", "accepted")
          .order("reviewed_at", { ascending: false });

        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        if (error) {
          console.error("records fetch error", error);
          return new Response(JSON.stringify({ records: [] }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ records: data ?? [] }), { status: 200, headers });
      },
    },
  },
});
