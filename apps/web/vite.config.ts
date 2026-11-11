import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@aws-svg": resolve(import.meta.dirname, "node_modules/@grafito/icons/src/aws") } },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html") },
    },
  },
  server: {
    port: 5173,
    // GRAFITO_HOST=1 listens on the local network, so other people can join a room from their own machine.
    host: process.env.GRAFITO_HOST === "1",
    watch: { ignored: ["**/pruebas/**"] },
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true, ws: true } },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
