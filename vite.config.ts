import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html") },
    },
  },
  server: {
    port: 5173,
    watch: { ignored: ["**/pruebas/**"] },
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "server/**/*.test.ts"] },
});
