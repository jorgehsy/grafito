import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHealthHandler } from "./health";
import type { Clients } from "./board";
import { fakeClaude } from "../claude/fake";

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function health(clients: Clients) {
  const app = express();
  app.get("/api/health", createHealthHandler(clients));
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const res = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/health`);
  return res.json();
}

describe("GET /api/health", () => {
  it("lists only the models whose provider is on", async () => {
    const api = fakeClaude([]);
    expect(await health({ "anthropic-api": api })).toEqual({ ok: true, hasKey: true, models: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
    expect(await health({ "claude-subscription": fakeClaude([]) })).toEqual({
      ok: true,
      hasKey: false,
      models: ["claude-sonnet-5-5@subscription", "claude-haiku-5-5@subscription"],
    });
  });
});
