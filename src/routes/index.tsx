import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GD TikTok List" },
      { name: "description", content: "The official GD TikTok List." },
      {
        // SSR redirect via meta refresh
        "http-equiv": "refresh",
        content: "0; url=/app.html",
      } as never,
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    window.location.replace("/app.html");
  }, []);
  return null;
}
