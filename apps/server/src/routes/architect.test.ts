import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createArchitectHandler } from "./architect";
import { PLAN_OFF } from "./turn";
import type { Clients } from "./turn";
import type { ClaudeClient } from "../claude/client";
import { fakeClaude, fail, start, stop, toolBlock } from "../claude/fake";
import type { FakeAttempt } from "../claude/fake";
import { ARCHITECT_SKETCH_RULES, NO_MESSAGE, architectSystemPrompt } from "../prompt/architect";

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

const BAD_ACTIONS = "Invalid actions: expected a list of {type: accept | reject, proposal}";
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

  it("falls back to Sonnet for an unknown model; a plan model goes to the subscription client", async () => {
    const api = fakeClaude([s3Turn]);
    await post(api, { text: "hi", model: "gone" });
    expect(api.calls[0].params.model).toBe("claude-sonnet-5-5");
    const haiku = fakeClaude([s3Turn]);
    await post(haiku, { text: "hi", model: "claude-haiku-5-5" });
    expect(haiku.calls[0].params.model).toBe("claude-haiku-5-5");
    const plan = fakeClaude([s3Turn]);
    const evs = await post({ "anthropic-api": fakeClaude([]), "claude-subscription": plan }, { text: "hi", model: "claude-sonnet-5-5@subscription" });
    expect(plan.calls[0].params).toMatchObject({ model: "claude-sonnet-5-5@subscription", opSet: "architect", adaptiveThinking: true });
    expect(evs.at(-1)!.data).toMatchObject({ model: "claude-sonnet-5-5@subscription" });
  });

  it("a plan model with the switch off is an error, never a paid API call (ADR 0004)", async () => {
    for (const model of ["claude-sonnet-5-5@subscription", "claude-haiku-5-5@subscription"]) {
      const api = fakeClaude([s3Turn]);
      const evs = await post(api, { text: "hi", model });
      expect(evs).toEqual([{ event: "error", data: { message: PLAN_OFF } }]);
      expect(api.calls).toHaveLength(0);
    }
  });

  it("shows Claude the clicks since the last turn; none and absent are the same", async () => {
    const fake = fakeClaude([s3Turn]);
    await post(fake, { text: "and a queue", actions: [{ type: "accept", proposal: "P3" }, { type: "reject", proposal: "P4" }] });
    expect(fake.calls[0].params.userText).toContain("USER CLICKS SINCE LAST TURN:\n- accept P3\n- reject P4\n\nUSER MESSAGE:\nand a queue");
    for (const body of [{ text: "hi", actions: [] }, { text: "hi" }]) {
      const f = fakeClaude([s3Turn]);
      await post(f, body);
      expect(f.calls[0].params.userText).not.toContain("CLICKS");
    }
  });

  it("rejects bad requests with an SSE error and never calls Claude", async () => {
    const cases: [ClaudeClient | null, unknown, string][] = [
      [null, { text: "hi" }, "Missing API key in .env"],
      [fakeClaude([]), {}, "The text is empty"],
      [fakeClaude([]), { text: "  " }, "The text is empty"],
      [fakeClaude([]), { text: "hi", recent: "x" }, "Invalid recent: expected a list of {text, bubble}"],
      [fakeClaude([]), { text: "hi", recent: [{ bubble: "b" }] }, "Invalid recent: expected a list of {text, bubble}"],
      [fakeClaude([]), { text: "hi", actions: { type: "accept", proposal: "P1" } }, BAD_ACTIONS],
      [fakeClaude([]), { text: "hi", actions: [{ type: "choose", proposal: "P1" }] }, BAD_ACTIONS],
      [fakeClaude([]), { text: "hi", actions: [{ type: "reject", proposal: "" }] }, BAD_ACTIONS],
      [fakeClaude([]), { actions: [{ type: "accept", proposal: "P1" }] }, "The text is empty"],
      [fakeClaude([]), { text: "hi", catalogs: ["made-up"] }, 'Invalid catalog: "made-up"'],
    ];
    for (const [client, body, message] of cases) {
      expect(await post(client, body)).toEqual([{ event: "error", data: { message } }]);
      if (client) expect((client as ReturnType<typeof fakeClaude>).calls).toHaveLength(0);
    }
  });

  it("a sketch turn sends the picture, the sketch rules and the strokes; the text with it may be empty", async () => {
    const PNG = "iVBORw0KGgo=";
    const fake = fakeClaude([s3Turn]);
    const evs = await post(fake, { sketch: { hints: "STROKES (1)\n- s1: a box", image: `data:image/png;base64,${PNG}` }, board: "ZONES\n- system [system]", catalogs: ["aws"], lang: "es-CL" });
    expect(names(evs)).toEqual(["op", "op", "op", "done"]);
    const p = fake.calls[0].params;
    expect(p.image).toEqual({ mediaType: "image/png", data: PNG });
    expect(p.system).toEqual(architectSystemPrompt({ catalogs: ["aws"], lang: "es-CL", sketch: true }));
    expect(p.system.map((b) => b.text)).toContain(ARCHITECT_SKETCH_RULES);
    expect(p.system[0]).toEqual(architectSystemPrompt({ catalogs: ["aws"], lang: "es-CL" })[0]);
    expect(p.userText).toContain("USER SKETCH (drawn by hand on the board):\nSTROKES (1)\n- s1: a box");
    expect(p.userText.endsWith(`USER MESSAGE:\n${NO_MESSAGE}`)).toBe(true);
    expect(p.opSet).toBe("architect");

    const typed = fakeClaude([s3Turn]);
    await post(typed, { text: "this is the cache", sketch: { hints: "STROKES" } });
    expect(typed.calls[0].params.image).toBeUndefined();
    expect(typed.calls[0].params.userText.endsWith("USER MESSAGE:\nthis is the cache")).toBe(true);
  });

  it("a turn without a sketch has no picture and no sketch rules", async () => {
    const fake = fakeClaude([s3Turn]);
    await post(fake, { text: "add an S3 bucket" });
    expect(fake.calls[0].params.image).toBeUndefined();
    expect(fake.calls[0].params.system.map((b) => b.text)).not.toContain(ARCHITECT_SKETCH_RULES);
    expect(fake.calls[0].params.userText).not.toContain("SKETCH");
  });

  it("rejects a malformed sketch, and an empty text without one, and never calls Claude", async () => {
    for (const sketch of ["ink", {}, { hints: "  " }, { hints: 3 }, { hints: "STROKES", image: "not base64!" }, null]) {
      const fake = fakeClaude([s3Turn]);
      expect(await post(fake, { text: "hi", sketch })).toEqual([{ event: "error", data: { message: expect.stringContaining("Invalid sketch") } }]);
      expect(fake.calls).toHaveLength(0);
    }
    const fake = fakeClaude([s3Turn]);
    expect(await post(fake, { text: "  " })).toEqual([{ event: "error", data: { message: "The text is empty" } }]);
    expect(await post(fake, { text: 4, sketch: { hints: "STROKES" } })).toEqual([{ event: "error", data: { message: "The text is empty" } }]);
    expect(fake.calls).toHaveLength(0);
  });

  it("passes the review so far to Claude, and rejects one that is not text", async () => {
    const fake = fakeClaude([s3Turn]);
    await post(fake, { text: "add a replica", review: "PILLARS\n- REL gap \"One database.\"\nFINDINGS\n- F1 [REL high] @db \"One database.\"" });
    expect(fake.calls[0].params.userText).toContain('REVIEW SO FAR:\nPILLARS\n- REL gap "One database."\nFINDINGS\n- F1 [REL high] @db "One database."\n\nRECENT TURNS:');
    const bad = fakeClaude([s3Turn]);
    expect(await post(bad, { text: "hi", review: { pillars: [] } })).toEqual([{ event: "error", data: { message: "Invalid review: expected text" } }]);
    expect(bad.calls).toHaveLength(0);
  });

  it("streams the review ops; a best practice that is not in the digest is left out of its finding, with a warning", async () => {
    const pillar = { pillar: "REL", status: "gap", note: "One of everything." };
    const real = { id: "F1", pillar: "REL", severity: "high", text: "One database: if it dies, everything stops.", target: "db", best_practice: "REL10-BP01" };
    const madeUp = { id: "F2", pillar: "SEC", severity: "medium", text: "The bucket is public.", target: "bucket", best_practice: "SEC99-BP42" };
    const evs = await post(fakeClaude([[
      start(),
      ...toolBlock(0, "assess_pillar", JSON.stringify(pillar)),
      ...toolBlock(1, "add_finding", JSON.stringify(real)),
      ...toolBlock(2, "add_finding", JSON.stringify(madeUp)),
      ...toolBlock(3, "add_finding", JSON.stringify({ ...real, id: "F3", severity: "critical" })),
      ...toolBlock(4, "resolve_finding", '{"id":"F0"}'),
      ...toolBlock(5, "say", JSON.stringify({ text: "One database. (REL10-BP01)", target: "db" })),
      ...stop("tool_use", 80),
    ]]), { text: "review it" });
    const { best_practice: _dropped, ...withoutPractice } = madeUp;
    expect(ops(evs)).toEqual([
      { name: "assess_pillar", input: pillar },
      { name: "add_finding", input: real },
      { name: "add_finding", input: withoutPractice },
      { invalid: true, name: "add_finding", warning: "add_finding: best practice 'SEC99-BP42' is not in the Well-Architected digest; left out" },
      { invalid: true, name: "add_finding", warning: expect.stringContaining("(at /severity)") },
      { name: "resolve_finding", input: { id: "F0" } },
      { name: "say", input: { text: "One database. (REL10-BP01)", target: "db" } },
    ]);
  });

  it("streams a data model: entities and relations are architect ops", async () => {
    const users = { zone: "data", id: "users", name: "users", fields: [{ name: "id", type: "uuid", key: "pk" }] };
    const evs = await post(fakeClaude([[
      start(),
      ...toolBlock(0, "add_entity", JSON.stringify(users)),
      ...toolBlock(1, "add_entity", JSON.stringify({ zone: "data", id: "orders", name: "orders" })),
      ...toolBlock(2, "relate", JSON.stringify({ id: "r1", from: "users", to: "orders", cardinality: "one_to_many" })),
      ...toolBlock(3, "say", '{"text":"Two tables."}'),
      ...stop("tool_use", 40),
    ]]), { text: "show me the tables" });
    expect(ops(evs).map((o) => (o as { name: string }).name)).toEqual(["add_entity", "add_entity", "relate", "say"]);
    expect(ops(evs)[0]).toEqual({ name: "add_entity", input: users });
  });
});
