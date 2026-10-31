import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { availableModelIds, createBoardHandler } from "./board";
import type { Clients } from "./board";
import type { ClaudeClient } from "../claude/client";
import { fakeClaude, fail, start, stop, toolBlock } from "../claude/fake";
import type { FakeAttempt } from "../claude/fake";
import { systemPrompt } from "../prompt/system";

// Every test goes through POST /api/board on a real ephemeral server, with the fake Claude adapter.

let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  return new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

// A bare client (or null = no key) stands for the API adapter alone.
const asClients = (c: ClaudeClient | null | Clients): Clients => (c === null ? {} : "stream" in c ? { "anthropic-api": c } : c);

async function listen(client: ClaudeClient | null | Clients): Promise<string> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.post("/api/board", createBoardHandler(asClients(client)));
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/board`;
}

type Ev = { event: string; data: any };
function parseSse(text: string): Ev[] {
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map((b) => {
      const [e, d] = b.split("\n");
      return { event: e.replace(/^event: /, ""), data: JSON.parse(d.replace(/^data: /, "")) };
    });
}

async function post(client: ClaudeClient | null | Clients, body: unknown): Promise<Ev[]> {
  const url = await listen(client);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  return parseSse(await res.text());
}

// Event names; usage events are left out (the estimate ones depend on timing).
const names = (evs: Ev[]) => evs.map((e) => e.event).filter((n) => n !== "usage");
const zone = (id: string) => JSON.stringify({ id, kind: "system", title: id.toUpperCase() });
const ok: FakeAttempt = [start({ input_tokens: 100 }), ...toolBlock(0, "create_zone", zone("a")), ...stop("tool_use", 20)];

describe("POST /api/board", () => {
  it("streams ops in order, with usage, then done", async () => {
    const fake = fakeClaude([
      [
        start({ input_tokens: 100, cache_read_input_tokens: 7, output_tokens: 1 }),
        ...toolBlock(0, "create_zone", zone("a"), 3),
        ...toolBlock(1, "create_zone", zone("b")),
        ...toolBlock(2, "update_summary", JSON.stringify({ text: "resumen" })),
        ...stop("tool_use", 42),
      ],
    ]);
    const evs = await post(fake, { delta: "hola" });
    expect(names(evs)).toEqual(["op", "op", "op", "done"]);
    expect(evs[0]).toEqual({ event: "usage", data: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 7, cache_creation_input_tokens: 0, estimated: true } });
    const opEvs = evs.filter((e) => e.event === "op");
    expect(opEvs.map((e) => e.data.input.id ?? e.data.name)).toEqual(["a", "b", "update_summary"]);
    expect(opEvs[0].data).toEqual({ name: "create_zone", input: { id: "a", kind: "system", title: "A" } });
    expect(evs.at(-2)).toEqual({ event: "usage", data: { input_tokens: 100, output_tokens: 42, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 } });
    const done = evs.at(-1)!.data;
    expect(done).toMatchObject({ ops: 3, model: "claude-haiku-5-5", mode: "content", usage: { input_tokens: 100, output_tokens: 42 } });
    expect(typeof done.timings.first_op_ms).toBe("number");
    expect(typeof done.timings.total_ms).toBe("number");
  });

  it("passes the prompt, model and limits for the request to the client", async () => {
    const fake = fakeClaude([ok]);
    await post(fake, { delta: "ordénalo", board: "ZONES\n- a", summary: "s", mode: "instruction", model: "claude-sonnet-5-5", catalogs: ["aws"], lang: "es-MX" });
    const p = fake.calls[0].params;
    expect(p).toMatchObject({ model: "claude-sonnet-5-5", maxTokens: 8192, effort: "medium", catalogs: ["aws"], system: systemPrompt({ catalogs: ["aws"], lang: "es-MX" }) });
    expect(p.userText).toContain("USER INSTRUCTION");
    expect(p.system.at(-1)).toEqual({ text: "All drawn text must be in Spanish." });

    const fake2 = fakeClaude([ok]);
    await post(fake2, { delta: "hola", model: "made-up", lang: "xx-YY" });
    expect(fake2.calls[0].params).toMatchObject({ model: "claude-haiku-5-5", maxTokens: 4096, effort: "low", catalogs: [], system: systemPrompt({ catalogs: [], lang: "en-US" }) });
  });

  it("skips a block with broken JSON with a warning and keeps going", async () => {
    const fake = fakeClaude([
      [start(), ...toolBlock(0, "create_zone", '{"id":"a" "kind"'), ...toolBlock(1, "create_zone", zone("b")), ...stop("tool_use", 5)],
    ]);
    const evs = await post(fake, { delta: "hola" });
    const opEvs = evs.filter((e) => e.event === "op");
    expect(opEvs[0].data).toEqual({ invalid: true, name: "create_zone", warning: "create_zone: malformed JSON (skipped)" });
    expect(opEvs[1].data.input.id).toBe("b");
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { ops: 1 } });
    expect(names(evs)).not.toContain("error");
  });

  it("an op that is not valid for the request's catalogs is skipped with a warning", async () => {
    const setService = JSON.stringify({ id: "a", service: "s3" });
    const off = await post(fakeClaude([[start(), ...toolBlock(0, "set_service", setService), ...stop("tool_use", 5)]]), { delta: "hola" });
    expect(off.find((e) => e.event === "op")?.data).toMatchObject({ invalid: true, name: "set_service", warning: expect.stringContaining("unknown") });
    server!.close();
    const on = await post(fakeClaude([[start(), ...toolBlock(0, "set_service", setService), ...stop("tool_use", 5)]]), { delta: "hola", catalogs: ["aws"] });
    expect(on.find((e) => e.event === "op")?.data).toEqual({ name: "set_service", input: { id: "a", service: "s3" } });
  });

  it("retries once on a 5xx before the first op", async () => {
    const fake = fakeClaude([[start({ input_tokens: 50 }), fail(529, "Overloaded")], ok]);
    const evs = await post(fake, { delta: "hola" });
    expect(fake.attempts).toBe(2);
    expect(names(evs)).not.toContain("error");
    expect(evs.filter((e) => e.event === "op")).toHaveLength(1);
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { ops: 1, usage: { input_tokens: 100, output_tokens: 20 } } });
  });

  it("does not retry after the first op", async () => {
    const fake = fakeClaude([[start(), ...toolBlock(0, "create_zone", zone("a")), fail(500, "Internal server error")], ok]);
    const evs = await post(fake, { delta: "hola" });
    expect(fake.attempts).toBe(1);
    expect(names(evs)).toEqual(["op", "error"]);
    expect(evs.at(-1)!.data).toEqual({ message: "Error calling Claude (HTTP 500): Internal server error" });
  });

  it("does not retry a 4xx other than 429, and retries only once", async () => {
    const bad = fakeClaude([[fail(400, "Bad request")], ok]);
    const evs = await post(bad, { delta: "hola" });
    expect(bad.attempts).toBe(1);
    expect(evs).toEqual([{ event: "error", data: { message: "Error calling Claude (HTTP 400): Bad request" } }]);
    server!.close();

    const twice = fakeClaude([[fail(429, "Rate limited")], [fail(undefined, "Connection error.")], ok]);
    const evs2 = await post(twice, { delta: "hola" });
    expect(twice.attempts).toBe(2);
    expect(evs2).toEqual([{ event: "error", data: { message: "Error calling Claude: Connection error." } }]);
  });

  it("refusal sends an error event, then done", async () => {
    const evs = await post(fakeClaude([[start(), ...stop("refusal", 3)]]), { delta: "hola" });
    expect(names(evs)).toEqual(["error", "done"]);
    expect(evs.at(-2)!.data).toEqual({ message: "The model refused the request (refusal)" });
  });

  it("max_tokens sends an error event after the ops, then done", async () => {
    const evs = await post(fakeClaude([[start(), ...toolBlock(0, "create_zone", zone("a")), ...stop("max_tokens", 4096)]]), { delta: "hola" });
    expect(names(evs)).toEqual(["op", "error", "done"]);
    expect(evs.at(-2)!.data).toEqual({ message: "Response cut off by max_tokens" });
    expect(evs.at(-1)!.data).toMatchObject({ ops: 1, usage: { output_tokens: 4096 } });
  });

  it("a client abort cancels the upstream signal and does not retry", async () => {
    const fake = fakeClaude(["hang", ok]);
    const url = await listen(fake);
    const ctl = new AbortController();
    // Headers are only flushed with the first event, so the fetch is still pending here.
    const pending = fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delta: "hola" }), signal: ctl.signal });
    const settled = pending.then(() => "resolved", () => "rejected");
    await new Promise<void>((resolve) => {
      const tick = () => (fake.calls.length ? resolve() : setTimeout(tick, 5));
      tick();
    });
    const signal = fake.calls[0].signal;
    expect(signal.aborted).toBe(false);
    ctl.abort();
    expect(await settled).toBe("rejected");
    await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve())));
    expect(signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.attempts).toBe(1);
  });

  it("rejects bad requests with an SSE error and never calls Claude", async () => {
    const cases: [ClaudeClient | null, unknown, string][] = [
      [null, { delta: "hola" }, "Missing API key in .env"],
      [fakeClaude([]), { delta: "  " }, "The text is empty"],
      [fakeClaude([]), { delta: "hola", shape: "blob" }, 'Invalid shape: "blob"'],
      [fakeClaude([]), { delta: "hola", mode: "shout" }, 'Invalid mode: "shout"'],
      [fakeClaude([]), { delta: "hola", catalogs: ["made-up"] }, 'Invalid catalog: "made-up"'],
      [fakeClaude([]), { delta: "hola", catalogs: "aws" }, 'Invalid catalogs: "aws"'],
    ];
    for (const [client, body, message] of cases) {
      const evs = await post(client, body);
      expect(evs).toEqual([{ event: "error", data: { message } }]);
      if (client) expect((client as ReturnType<typeof fakeClaude>).calls).toHaveLength(0);
      server!.close();
    }
  });

  describe("providers", () => {
    const PLAN = "claude-sonnet-5-5@subscription";
    const API = "claude-sonnet-5-5";
    const HAIKU = "claude-haiku-5-5";

    it("the switch off hides the plan models", () => {
      expect(availableModelIds({ "anthropic-api": fakeClaude([]) })).toEqual([API, HAIKU]);
      expect(availableModelIds({ "anthropic-api": fakeClaude([]), "claude-subscription": fakeClaude([]) })).toEqual([API, HAIKU, PLAN, "claude-haiku-5-5@subscription"]);
      expect(availableModelIds({})).toEqual([]);
    });

    it("a plan model goes to the subscription client with its plan id", async () => {
      const api = fakeClaude([]);
      const plan = fakeClaude([ok]);
      const evs = await post({ "anthropic-api": api, "claude-subscription": plan }, { delta: "hola", model: PLAN });
      expect(evs.at(-1)!.data).toMatchObject({ model: PLAN });
      expect(plan.calls.map((c) => c.params.model)).toEqual([PLAN]);
      expect(api.calls).toHaveLength(0);
    });

    it("an API model still goes to the API client when the plan is on", async () => {
      const api = fakeClaude([ok]);
      const plan = fakeClaude([]);
      await post({ "anthropic-api": api, "claude-subscription": plan }, { delta: "hola", model: API });
      expect(api.calls.map((c) => c.params.model)).toEqual([API]);
      expect(plan.calls).toHaveLength(0);
    });

    it("a plan model with the switch off falls back to the default, never to its API twin", async () => {
      const api = fakeClaude([ok]);
      const evs = await post({ "anthropic-api": api }, { delta: "hola", model: PLAN });
      expect(evs.at(-1)!.data).toMatchObject({ model: HAIKU });
      expect(api.calls.map((c) => c.params.model)).toEqual([HAIKU]);
    });

    it("with no API key, an API model does not fall back to a plan model: it errors", async () => {
      const plan = fakeClaude([]);
      const evs = await post({ "claude-subscription": plan }, { delta: "hola", model: API });
      expect(evs).toEqual([{ event: "error", data: { message: "Missing API key in .env" } }]);
      expect(plan.calls).toHaveLength(0);
    });

    it("login and plan-limit errors show without the HTTP status; others keep it", async () => {
      const msg = async (status: number, text: string) => {
        const evs = await post({ "claude-subscription": fakeClaude([[fail(status, text)]]), "anthropic-api": fakeClaude([]) }, { delta: "hola", model: PLAN });
        server!.close();
        return evs.find((e) => e.event === "error")!.data.message;
      };
      expect(await msg(401, "not logged in")).toBe("Error calling Claude: not logged in");
      expect(await msg(402, "plan limit reached")).toBe("Error calling Claude: plan limit reached");
      expect(await msg(400, "bad")).toBe("Error calling Claude (HTTP 400): bad");
    });
  });
});
