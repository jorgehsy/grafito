// The eval serves the real route handlers in its own process, on an ephemeral port, so a run goes through the
// same validation, prompt and SSE code as the app.
import express from "express";
import type { RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export async function serveHandler(path: string, handler: RequestHandler): Promise<{ url: string; close(): Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.post(path, handler);
  const server = await new Promise<Server>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  server.unref();
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
    close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
