import { afterEach, describe, expect, it } from "vitest";
import { ARCHITECT_ZONE_ID, applyOps, emptyBoard } from "@grafito/board";
import type { Board } from "@grafito/board";
import { ARCHITECT_PROMPT_VERSION, op } from "@grafito/contract";
import { createArchitectSession, recentTurns } from "./session";
import type { ArchitectSession, ArchitectSessionState, ArchitectSettings } from "./session";

const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (chunks: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200 });
};
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 };
const done = ev("done", { usage, timings: { first_op_ms: 7, total_ms: 20 }, ops: 1, model: "claude-sonnet-5-5" });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean) {
  for (let k = 0; k < 200 && !cond(); k++) await tick();
  expect(cond()).toBe(true);
}

const bucket = op.add_component({ zone: ARCHITECT_ZONE_ID, id: "bucket", label: "Bucket", type: "storage", service: "s3" });
const say = (text: string, target?: string) => ev("op", { name: "say", input: target ? { text, target } : { text } });

const open: ArchitectSession[] = [];
afterEach(() => { open.splice(0).forEach((s) => s.stop()); });

function harness(respond: (i: number) => string[] = () => [done], settings: Partial<ArchitectSettings> = {}) {
  let board: Board = emptyBoard();
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requests.push({ url, body });
    return sse(respond(requests.length - 1));
  }) as unknown as typeof fetch;
  const session = createArchitectSession({
    board: { get: () => board, submit: async (ops) => { board = applyOps(board, ops).board; }, clear: () => { board = emptyBoard(); } },
    settings: { get: () => ({ model: "claude-sonnet-5-5", catalogs: ["aws"], lang: "es-CL", ...settings }) },
    zoneTitle: () => "Architecture",
    fetchImpl,
  });
  open.push(session);
  let state!: ArchitectSessionState;
  session.subscribe((s) => (state = s));
  session.start();
  return { session, requests, board: () => board, state: () => state };
}
const settled = (h: ReturnType<typeof harness>, n: number) => until(() => h.state().turns.length === n && !h.state().busy);

describe("architect session: start", () => {
  it("starts on a blank board with only the app-made system zone", async () => {
    const h = harness();
    await tick();
    expect(h.board().zones).toEqual([expect.objectContaining({ id: ARCHITECT_ZONE_ID, kind: "system", title: "Architecture" })]);
    expect(h.board().elements).toEqual([]);
    expect(h.state()).toEqual({ turns: [], busy: false, bubble: null, error: "" });
  });
});

describe("architect session: a turn", () => {
  it("posts the typed text with the board, summary, model, language and catalogs to /api/architect", async () => {
    const h = harness();
    await tick();
    expect(h.session.send("  add an S3 bucket ")).toBe(true);
    await settled(h, 1);
    expect(h.requests).toHaveLength(1);
    const { url, body } = h.requests[0];
    expect(url).toBe("/api/architect");
    expect(body).toEqual({ text: "add an S3 bucket", board: expect.stringContaining("system [system]"), summary: "", recent: [], model: "claude-sonnet-5-5", lang: "es-CL", catalogs: ["aws"] });
    expect(h.state().turns[0]).toMatchObject({ n: 1, text: "add an S3 bucket", model: "claude-sonnet-5-5", promptVersion: ARCHITECT_PROMPT_VERSION, done: true, totalMs: 20, usage });
  });

  it("draws the drawing ops in ink and puts the say in the bubble, not on the board", async () => {
    const h = harness(() => [ev("op", bucket), say("Who reads from it?", "bucket"), ev("op", { name: "update_summary", input: { text: "One bucket." } }), done]);
    await tick();
    h.session.send("add an S3 bucket");
    await settled(h, 1);
    expect(h.board().elements).toEqual([expect.objectContaining({ id: "bucket", zone: "system", service: "aws:s3" })]);
    expect(h.board().summary).toBe("One bucket.");
    expect(h.state().bubble).toEqual({ text: "Who reads from it?", target: "bucket" });
    expect(h.state().turns[0].ops.map((o) => o.name)).toEqual(["add_component", "say", "update_summary"]);
  });

  it("the last say wins; a turn with none shows no bubble and still succeeds", async () => {
    const h = harness((i) => (i === 0 ? [say("one"), say("two"), done] : [ev("op", bucket), done]));
    await tick();
    h.session.send("hi");
    await settled(h, 1);
    expect(h.state().bubble).toEqual({ text: "two" });
    h.session.send("add a bucket");
    await settled(h, 2);
    expect(h.state().bubble).toBeNull();
    expect(h.state().error).toBe("");
    expect(h.board().elements).toHaveLength(1);
  });

  it("ops outside the architect set become warnings", async () => {
    const h = harness(() => [ev("op", { name: "create_zone", input: { id: "z", kind: "flow", title: "Z" } }), say("ok"), done]);
    await tick();
    h.session.send("hi");
    await settled(h, 1);
    expect(h.state().turns[0].warnings).toEqual(['create_zone: unknown tool "create_zone"']);
    expect(h.board().zones.map((z) => z.id)).toEqual(["system"]);
  });

  it("sends the last 3 turns word for word: user text and bubble text", async () => {
    const h = harness((i) => (i === 1 ? [done] : [say(`bubble ${i}`), done]));
    await tick();
    for (let k = 0; k < 5; k++) { h.session.send(`ask ${k}`); await settled(h, k + 1); }
    expect(h.requests[0].body.recent).toEqual([]);
    expect(h.requests[4].body.recent).toEqual([
      { text: "ask 1", bubble: "" },
      { text: "ask 2", bubble: "bubble 2" },
      { text: "ask 3", bubble: "bubble 3" },
    ]);
  });

  it("one turn at a time; blank text is not a turn", async () => {
    const h = harness(() => [say("ok"), done]);
    await tick();
    expect(h.session.send("  ")).toBe(false);
    expect(h.session.send("one")).toBe(true);
    expect(h.state().busy).toBe(true);
    expect(h.session.send("two")).toBe(false);
    await settled(h, 1);
    expect(h.requests.map((r) => r.body.text)).toEqual(["one"]);
  });

  it("shows the server's error and stays usable", async () => {
    const h = harness((i) => (i === 0 ? [ev("error", { message: "Missing API key in .env" })] : [say("ok"), done]));
    await tick();
    h.session.send("one");
    await settled(h, 1);
    expect(h.state()).toMatchObject({ error: "Missing API key in .env", bubble: null, busy: false });
    h.session.send("two");
    await settled(h, 2);
    expect(h.state()).toMatchObject({ error: "", bubble: { text: "ok" } });
  });
});

describe("recent turns", () => {
  it("leaves out the turn in flight", () => {
    const turn = (text: string, isDone: boolean) => ({ text, done: isDone, bubble: { text: "b" } }) as Parameters<typeof recentTurns>[0][number];
    expect(recentTurns([turn("a", true), turn("b", false)])).toEqual([{ text: "a", bubble: "b" }]);
  });
});
