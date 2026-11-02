import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createArchitectHandler } from "./architect";
import type { Clients } from "./turn";
import type { ClaudeClient } from "../claude/client";
import { fakeClaude, fail, start, stop, toolBlock } from "../claude/fake";
import type { FakeAttempt } from "../claude/fake";
import { architectSystemPrompt } from "../prompt/architect";

// Every test goes through POST /api/architect on a real ephemeral server, with the fake Claude adapter.

let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  return new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

const asClients = (c: ClaudeClient | null | Clients): Clients => (c === null ? {} : "stream" in c ? { "anthropic-api": c } : c);

type Ev = { event: string; data: unknown };
const parseSse = (text: string): Ev[] =>
  text
    .split("\n\n")
    .filter((b) => b.trim())
    .map((b) => {
      const [e, d] = b.split("\n");
      return { event: e.replace(/^event: /, ""), data: JSON.parse(d.replace(/^data: /, "")) };
    });

async function post(client: ClaudeClient | null | Clients, body: unknown): Promise<Ev[]> {
  server?.close();
  const app = express();
  app.use(express.json());
  app.post("/api/architect", createArchitectHandler(asClients(client)));
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/architect`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  return parseSse(await res.text());
}

const names = (evs: Ev[]) => evs.map((e) => e.event).filter((n) => n !== "usage");
const ops = (evs: Ev[]) => evs.filter((e) => e.event === "op").map((e) => e.data);

const bucket = { zone: "system", id: "bucket", label: "Bucket", type: "storage", service: "s3" };
const say = { text: "Who reads from it: users directly, or only your app?", target: "bucket" };
const s3Turn: FakeAttempt = [
  start({ input_tokens: 900, cache_read_input_tokens: 12000 }),
  ...toolBlock(0, "add_component", JSON.stringify(bucket)),
  ...toolBlock(1, "say", JSON.stringify(say)),
  ...toolBlock(2, "update_summary", JSON.stringify({ text: "One S3 bucket." })),
  ...stop("tool_use", 300),
];

describe("POST /api/architect", () => {
  it("streams the turn's drawing ops and its say, then done", async () => {
    const evs = await post(fakeClaude([s3Turn]), { text: "add an S3 bucket", catalogs: ["aws"] });
    expect(names(evs)).toEqual(["op", "op", "op", "done"]);
    expect(ops(evs)).toEqual([
      { name: "add_component", input: bucket },
      { name: "say", input: say },
      { name: "update_summary", input: { text: "One S3 bucket." } },
    ]);
    const done = evs.at(-1)!.data;
    expect(done).toMatchObject({ ops: 3, model: "claude-sonnet-5-5", usage: { input_tokens: 900, cache_read_input_tokens: 12000, output_tokens: 300 } });
    expect(done).not.toHaveProperty("mode");
  });

  it("asks Claude with the architect prompt, tools and limits: Sonnet, medium effort, adaptive thinking, 16000 tokens", async () => {
    const fake = fakeClaude([s3Turn]);
    const recent = [1, 2, 3, 4].map((n) => ({ text: `ask ${n}`, bubble: `bubble ${n}` }));
    await post(fake, { text: "add an S3 bucket", board: "ZONES\n- system [system]", summary: "s", recent, catalogs: ["aws"], lang: "es-MX" });
    const p = fake.calls[0].params;
    expect(p).toEqual({
      model: "claude-sonnet-5-5",
      maxTokens: 16000,
      effort: "medium",
      adaptiveThinking: true,
      system: architectSystemPrompt({ catalogs: ["aws"], lang: "es-MX" }),
      userText: expect.stringContaining("USER MESSAGE:\nadd an S3 bucket"),
      catalogs: ["aws"],
      opSet: "architect",
    });
    expect(p.userText).toContain("ZONES\n- system [system]");
    expect(p.userText).toContain("USER: ask 2\nYOUR BUBBLE: bubble 2");
    expect(p.userText).not.toContain("ask 1");
  });

  it("accepts only the architect op set: zone ops are skipped with a warning", async () => {
    const zone = JSON.stringify({ id: "z", kind: "flow", title: "Z" });
    const evs = await post(fakeClaude([[start(), ...toolBlock(0, "create_zone", zone), ...toolBlock(1, "say", JSON.stringify({ text: "Done." })), ...stop("tool_use", 5)]]), { text: "hi" });
    expect(ops(evs)).toEqual([
      { invalid: true, name: "create_zone", warning: 'create_zone: unknown tool "create_zone"' },
      { name: "say", input: { text: "Done." } },
    ]);
  });

  it("passes every say through (the browser shows the last) and never fails a turn without one", async () => {
    const two = await post(fakeClaude([[start(), ...toolBlock(0, "say", '{"text":"one"}'), ...toolBlock(1, "say", '{"text":"two"}'), ...stop("tool_use", 5)]]), { text: "hi" });
    expect(ops(two).map((o) => (o as { input: { text: string } }).input.text)).toEqual(["one", "two"]);
    const none = await post(fakeClaude([[start(), ...toolBlock(0, "update_summary", '{"text":"s"}'), ...stop("tool_use", 5)]]), { text: "hi" });
    expect(names(none)).toEqual(["op", "done"]);
  });

  it("streams proposals: propose, drawing ops under it, and accept or reject on the next turn", async () => {
    const comp = (id: string, type: string, service: string) => JSON.stringify({ zone: "system", id, label: id, type, service, proposal: "P1" });
    const first = await post(fakeClaude([[
      start(),
      ...toolBlock(0, "propose", JSON.stringify({ id: "P1", label: "Static site" })),
      ...toolBlock(1, "add_component", comp("dns", "service", "route-53")),
      ...toolBlock(2, "add_component", comp("cdn", "service", "cloudfront")),
      ...toolBlock(3, "connect", JSON.stringify({ id: "c1", from: "dns", to: "cdn", proposal: "P1" })),
      ...toolBlock(4, "say", JSON.stringify({ text: "Does it call an API?", target: "P1" })),
      ...stop("tool_use", 50),
    ]]), { text: "let's build a React webpage", catalogs: ["aws"] });
    expect(ops(first).map((o) => (o as { name: string }).name)).toEqual(["propose", "add_component", "add_component", "connect", "say"]);
    expect(ops(first)[1]).toEqual({ name: "add_component", input: JSON.parse(comp("dns", "service", "route-53")) });
    const fake = fakeClaude([[start(), ...toolBlock(0, "accept", '{"proposal":"P1"}'), ...toolBlock(1, "reject", '{"proposal":"P2"}'), ...toolBlock(2, "say", '{"text":"Kept."}'), ...stop("tool_use", 5)]]);
    const next = await post(fake, { text: "yes", board: 'ELEMENTS\n- dns (component/service) "dns" @system [pencil P1]\nPROPOSALS\n- P1 "Static site"' });
    expect(ops(next)).toEqual([{ name: "accept", input: { proposal: "P1" } }, { name: "reject", input: { proposal: "P2" } }, { name: "say", input: { text: "Kept." } }]);
    // the typed answer goes to Claude word for word, with the open proposals in the board text
    expect(fake.calls[0].params.userText).toContain('[pencil P1]\nPROPOSALS\n- P1 "Static site"');
    expect(fake.calls[0].params.userText.endsWith("USER MESSAGE:\nyes")).toBe(true);
  });

  it("a proposal on an op that only changes is invalid", async () => {
    const evs = await post(fakeClaude([[start(), ...toolBlock(0, "delete", '{"id":"cdn","proposal":"P1"}'), ...stop("tool_use", 5)]]), { text: "hi" });
    expect(ops(evs)).toEqual([{ invalid: true, name: "delete", warning: expect.stringMatching(/^delete: /) }]);
  });

  it("retries once on a 5xx before the first op, like /api/board", async () => {
    const fake = fakeClaude([[start(), fail(529, "Overloaded")], s3Turn]);
    const evs = await post(fake, { text: "hi", catalogs: ["aws"] });
    expect(fake.attempts).toBe(2);
    expect(names(evs)).toEqual(["op", "op", "op", "done"]);
  });

  it("falls back to Sonnet for an unknown or unavailable model; a plan model goes to the subscription client", async () => {
    const api = fakeClaude([s3Turn]);
    await post(api, { text: "hi", model: "claude-haiku-5-5@subscription" });
    expect(api.calls[0].params.model).toBe("claude-sonnet-5-5");
    const haiku = fakeClaude([s3Turn]);
    await post(haiku, { text: "hi", model: "claude-haiku-5-5" });
    expect(haiku.calls[0].params.model).toBe("claude-haiku-5-5");
    const plan = fakeClaude([s3Turn]);
    const evs = await post({ "anthropic-api": fakeClaude([]), "claude-subscription": plan }, { text: "hi", model: "claude-sonnet-5-5@subscription" });
    expect(plan.calls[0].params).toMatchObject({ model: "claude-sonnet-5-5@subscription", opSet: "architect", adaptiveThinking: true });
    expect(evs.at(-1)!.data).toMatchObject({ model: "claude-sonnet-5-5@subscription" });
  });

  it("rejects bad requests with an SSE error and never calls Claude", async () => {
    const cases: [ClaudeClient | null, unknown, string][] = [
      [null, { text: "hi" }, "Missing API key in .env"],
      [fakeClaude([]), {}, "The text is empty"],
      [fakeClaude([]), { text: "  " }, "The text is empty"],
      [fakeClaude([]), { text: "hi", recent: "x" }, "Invalid recent: expected a list of {text, bubble}"],
      [fakeClaude([]), { text: "hi", recent: [{ bubble: "b" }] }, "Invalid recent: expected a list of {text, bubble}"],
      [fakeClaude([]), { text: "hi", catalogs: ["made-up"] }, 'Invalid catalog: "made-up"'],
    ];
    for (const [client, body, message] of cases) {
      expect(await post(client, body)).toEqual([{ event: "error", data: { message } }]);
      if (client) expect((client as ReturnType<typeof fakeClaude>).calls).toHaveLength(0);
    }
  });
});
