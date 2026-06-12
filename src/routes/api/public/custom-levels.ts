import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/custom-levels")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("custom_levels")
          .select("*")
          .order("position", { ascending: true });

        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        if (error) {
          console.error("custom_levels fetch error", error);
          return new Response(JSON.stringify({ levels: [] }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ levels: data ?? [] }), { status: 200, headers });
      },
    },
  },
});
