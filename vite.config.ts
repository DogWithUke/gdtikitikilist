import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    plugins: [],
  },
  tanstackStart: {
    server: {
      entry: "server",
    },
  },
});
