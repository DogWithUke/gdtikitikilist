import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/list-editors")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("list_editors")
          .select("role, name, link, sort_order")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        if (error) {
          console.error("list_editors fetch error", error);
          return new Response(JSON.stringify({ editors: [] }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ editors: data ?? [] }), { status: 200, headers });
      },
    },
  },
});
