import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hidden-levels")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("hidden_levels")
          .select("name");
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        if (error) {
          console.error("hidden_levels fetch error", error);
          return new Response(JSON.stringify({ names: [] }), { status: 200, headers });
        }
        return new Response(
          JSON.stringify({ names: (data ?? []).map((r) => r.name) }),
          { status: 200, headers },
        );
      },
    },
  },
});
