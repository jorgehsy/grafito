import { afterEach, describe, expect, it } from "vitest";
import { ARCHITECT_ZONE_ID, applyOps, emptyBoard } from "@grafito/board";
import type { Board } from "@grafito/board";
import { ARCHITECT_PROMPT_VERSION, op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { createArchitectSession, pickProposal, recentTurns } from "./session";
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

function harness(respond: (i: number) => string[] = () => [done], settings: Partial<ArchitectSettings> = {}, lag?: Op[][]) {
  let board: Board = emptyBoard();
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requests.push({ url, body });
    return sse(respond(requests.length - 1));
  }) as unknown as typeof fetch;
  const session = createArchitectSession({
    // With `lag`, submitted ops wait there until the test applies them, like the controller's layout step.
    board: { get: () => board, submit: async (ops) => { if (lag) lag.push(ops); else board = applyOps(board, ops).board; }, clear: () => { board = emptyBoard(); } },
    settings: { get: () => ({ model: "claude-sonnet-5-5", catalogs: ["aws"], lang: "es-CL", ...settings }) },
    zoneTitle: () => "Architecture",
    fetchImpl,
  });
  open.push(session);
  let state!: ArchitectSessionState;
  session.subscribe((s) => (state = s));
  session.start();
  const flush = () => { for (const ops of lag?.splice(0) ?? []) board = applyOps(board, ops).board; };
  return { session, requests, board: () => board, state: () => state, flush };
}
const settled = (h: ReturnType<typeof harness>, n: number) => until(() => h.state().turns.length === n && !h.state().busy);

describe("architect session: start", () => {
  it("starts on a blank board with only the app-made system zone", async () => {
    const h = harness();
    await tick();
    expect(h.board().zones).toEqual([expect.objectContaining({ id: ARCHITECT_ZONE_ID, kind: "system", title: "Architecture" })]);
    expect(h.board().elements).toEqual([]);
    expect(h.state()).toEqual({ turns: [], busy: false, bubble: null, error: "", clicks: [] });
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
    expect(body).toEqual({ text: "add an S3 bucket", board: expect.stringContaining("system [system]"), summary: "", recent: [], actions: [], model: "claude-sonnet-5-5", lang: "es-CL", catalogs: ["aws"] });
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

describe("architect session: proposals", () => {
  const opEv = (name: string, input: unknown) => ev("op", { name, input });
  const site = (id: string, service: string) => opEv("add_component", { zone: ARCHITECT_ZONE_ID, id, label: id, type: id === "files" ? "storage" : "service", service, proposal: "P1" });
  const pencilTurn = [
    opEv("propose", { id: "P1", label: "Static site" }),
    site("dns", "route-53"), site("cdn", "cloudfront"), site("files", "s3"),
    opEv("connect", { id: "c1", from: "dns", to: "cdn", proposal: "P1" }),
    opEv("connect", { id: "c2", from: "cdn", to: "files", proposal: "P1" }),
    say("Does it call an API, or is it only pages?", "P1"),
    opEv("update_summary", { text: "Proposed a static site (P1)." }),
    done,
  ];

  it("draws Claude's proposal in pencil, then sends the typed yes as is and inks it on accept", async () => {
    const h = harness((i) => (i === 0 ? pencilTurn : [opEv("accept", { proposal: "P1" }), say("Kept. Next: the API?"), done]));
    await tick();
    h.session.send("let's build a React webpage");
    await settled(h, 1);
    expect(h.board().proposals).toEqual([{ id: "P1", label: "Static site" }]);
    expect(h.board().elements.map((e) => [e.id, e.proposal])).toEqual([["dns", "P1"], ["cdn", "P1"], ["files", "P1"]]);
    expect(h.state().bubble).toEqual({ text: "Does it call an API, or is it only pages?", target: "P1" });

    h.session.send("yes");
    await settled(h, 2);
    const body = h.requests[1].body;
    expect(body.text).toBe("yes");
    expect(body.board).toContain('- cdn (component/service) "cdn" @system service:cloudfront [pencil P1]');
    expect(body.board).toContain('PROPOSALS\n- P1 "Static site"');
    expect(h.board().proposals).toEqual([]);
    expect(h.board().elements.map((e) => e.id)).toEqual(["dns", "cdn", "files"]);
    expect([...h.board().elements, ...h.board().connections].some((x) => x.proposal)).toBe(false);
  });

  it("no erases the proposal; B keeps the second alternative and erases the first", async () => {
    const alts = [
      opEv("propose", { id: "P2", label: "Relational" }),
      opEv("add_component", { zone: ARCHITECT_ZONE_ID, id: "rds", label: "RDS", type: "database", proposal: "P2" }),
      opEv("propose", { id: "P3", label: "Key-value", alternative_to: "P2" }),
      opEv("add_component", { zone: ARCHITECT_ZONE_ID, id: "ddb", label: "DynamoDB", type: "database", proposal: "P3" }),
      say("A (RDS) or B (DynamoDB)?"),
      done,
    ];
    const h = harness((i) => [pencilTurn, [opEv("reject", { proposal: "P1" }), say("Gone."), done], alts, [opEv("accept", { proposal: "P3" }), say("DynamoDB it is."), done]][i]);
    await tick();
    for (const [k, text] of ["build a webpage", "no", "add a database", "B"].entries()) { h.session.send(text); await settled(h, k + 1); }
    expect(h.requests[3].body.board).toContain('PROPOSALS\n- P2 "Relational" (A; alternative to P3)\n- P3 "Key-value" (B; alternative to P2)');
    expect(h.board().elements.map((e) => e.id)).toEqual(["ddb"]);
    expect(h.board().proposals).toEqual([]);
  });
});

describe("architect session: clicks", () => {
  const opEv = (name: string, input: unknown) => ev("op", { name, input });
  const comp = (id: string, proposal: string) => opEv("add_component", { zone: ARCHITECT_ZONE_ID, id, label: id, type: "service", proposal });
  /** P1 on its own; P2 and P3 alternatives of each other. */
  const three = [
    opEv("propose", { id: "P1", label: "CDN" }), comp("cdn", "P1"),
    opEv("propose", { id: "P2", label: "Relational" }), comp("rds", "P2"),
    opEv("propose", { id: "P3", label: "Key-value", alternative_to: "P2" }), comp("ddb", "P3"),
    say("CDN? And A or B?"),
    done,
  ];
  const pencil = (b: Board) => b.elements.filter((e) => e.proposal).map((e) => e.id);

  async function drawn(respond: (i: number) => string[] = (i) => (i === 0 ? three : [say("Noted."), done]), lag?: Op[][]) {
    const h = harness(respond, {}, lag);
    await tick();
    h.session.send("build it");
    await settled(h, 1);
    h.flush();
    return h;
  }

  it("✓ inks and ✗ erases at once, with no request; the clicks queue in order with their time", async () => {
    const h = await drawn();
    const before = Date.now();
    expect(h.session.decide("accept", "P1")).toBe(true);
    expect(h.session.decide("reject", "P2")).toBe(true);
    await tick();
    expect(h.requests).toHaveLength(1);
    expect(h.board().elements.map((e) => [e.id, e.proposal ?? null])).toEqual([["cdn", null], ["ddb", "P3"]]);
    expect(h.board().proposals.map((p) => p.id)).toEqual(["P3"]);
    expect(h.state().clicks).toEqual([{ type: "accept", proposal: "P1", at: expect.any(Number) }, { type: "reject", proposal: "P2", at: expect.any(Number) }]);
    expect(h.state().clicks[0].at).toBeGreaterThanOrEqual(before);
  });

  it("sends the clicks as the next turn's actions, then clears them; a turn without clicks sends []", async () => {
    const h = await drawn();
    h.session.decide("accept", "P1");
    h.session.decide("reject", "P2");
    h.session.send("now a queue");
    expect(h.state().clicks).toEqual([]);
    await settled(h, 2);
    expect(h.requests[0].body.actions).toEqual([]);
    expect(h.requests[1].body.actions).toEqual([{ type: "accept", proposal: "P1" }, { type: "reject", proposal: "P2" }]);
    // the board sent is the one after the clicks
    expect(h.requests[1].body.board).not.toContain("[pencil P1]");
    h.session.send("and more");
    await settled(h, 3);
    expect(h.requests[2].body.actions).toEqual([]);
  });

  it("a click alone is not a turn: nothing is sent until the user types", async () => {
    const h = await drawn();
    h.session.decide("accept", "P1");
    expect(h.session.send("  ")).toBe(false);
    await tick();
    expect(h.requests).toHaveLength(1);
    expect(h.state().clicks).toHaveLength(1);
  });

  it("choosing an alternative is an accept: it is inked and the other one erased", async () => {
    const h = await drawn();
    expect(h.session.decide("accept", "P3")).toBe(true);
    await tick();
    expect(h.board().elements.map((e) => e.id)).toEqual(["cdn", "ddb"]);
    expect(pencil(h.board())).toEqual(["cdn"]);
    expect(h.board().proposals.map((p) => p.id)).toEqual(["P1"]);
    expect(h.state().clicks.map(({ type, proposal }) => ({ type, proposal }))).toEqual([{ type: "accept", proposal: "P3" }]);
  });

  it("a click on a closed or unknown proposal is ignored", async () => {
    const h = await drawn();
    h.session.decide("accept", "P3");
    await tick();
    expect(h.session.decide("reject", "P2")).toBe(false);
    expect(h.session.decide("accept", "P3")).toBe(false);
    expect(h.session.decide("accept", "P9")).toBe(false);
    expect(h.state().clicks).toHaveLength(1);
  });

  it("while the board still lags, a second click on the same proposal or on the erased alternative is ignored", async () => {
    const lag: Op[][] = [];
    const h = await drawn(undefined, lag);
    expect(h.session.decide("accept", "P2")).toBe(true);
    expect(h.board().proposals).toHaveLength(3);
    expect(h.session.decide("reject", "P2")).toBe(false);
    expect(h.session.decide("accept", "P3")).toBe(false);
    expect(h.session.decide("reject", "P1")).toBe(true);
    expect(lag).toEqual([[op.accept({ proposal: "P2" })], [op.reject({ proposal: "P1" })]]);
    h.flush();
    expect(h.board().elements.map((e) => e.id)).toEqual(["rds"]);
  });

  it("a click while a turn is in flight waits for the next turn", async () => {
    const h = await drawn();
    h.session.send("second");
    expect(h.state().busy).toBe(true);
    h.session.decide("reject", "P1");
    await settled(h, 2);
    expect(h.requests[1].body.actions).toEqual([]);
    expect(h.state().clicks.map((c) => c.proposal)).toEqual(["P1"]);
    h.session.send("third");
    await settled(h, 3);
    expect(h.requests[2].body.actions).toEqual([{ type: "reject", proposal: "P1" }]);
  });

  it("a click on the board selects a lone proposal, chooses an alternative at once, and ignores ink and paper", async () => {
    const h = await drawn((i) => (i === 0 ? [ev("op", bucket), ...three] : [done]));
    const b = h.board();
    expect(pickProposal(b, "cdn")).toEqual({ do: "select", proposal: "P1" });
    expect(pickProposal(b, "ddb")).toEqual({ do: "choose", proposal: "P3" });
    expect(pickProposal(b, "rds")).toEqual({ do: "choose", proposal: "P2" });
    for (const key of ["bucket", ARCHITECT_ZONE_ID, "nope", null]) expect(pickProposal(b, key)).toEqual({ do: "none" });
    // once its sibling is gone, the one left is a lone proposal again
    h.session.decide("reject", "P2");
    await tick();
    expect(pickProposal(h.board(), "ddb")).toEqual({ do: "select", proposal: "P3" });
  });

  it("starting over drops the queued clicks", async () => {
    const h = await drawn();
    h.session.decide("accept", "P1");
    h.session.start();
    expect(h.state().clicks).toEqual([]);
  });
});

describe("recent turns", () => {
  it("leaves out the turn in flight", () => {
    const turn = (text: string, isDone: boolean) => ({ text, done: isDone, bubble: { text: "b" } }) as Parameters<typeof recentTurns>[0][number];
    expect(recentTurns([turn("a", true), turn("b", false)])).toEqual([{ text: "a", bubble: "b" }]);
  });
});
