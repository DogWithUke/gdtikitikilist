import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/my-submissions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const username = (url.searchParams.get("username") || "").trim();
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        };
        if (!username || username.length > 64) {
          return new Response(JSON.stringify({ submissions: [] }), { status: 200, headers });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("submissions")
          .select("id, level, level_path, status, hz, created_at, reviewed_at, record_link")
          .ilike("username", username)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) {
          console.error("my-submissions error", error);
          return new Response(JSON.stringify({ submissions: [] }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ submissions: data ?? [] }), { status: 200, headers });
      },
    },
  },
});
