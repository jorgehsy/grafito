import { afterEach, describe, expect, it } from "vitest";
import { applyOps, emptyBoard } from "@grafito/board";
import type { Board } from "@grafito/board";
import { costUsd, OUTDATED_RECORD, parseRecord, PROMPT_VERSION, zeroUsage } from "@grafito/contract";
import type { SessionRecord } from "@grafito/contract";
import { createLiveSession, RECORD_KEY } from "./session";
import type { LiveSession, LiveSessionState, Settings } from "./session";
import { memoryStore } from "../storage";
import type { Store } from "../storage";
import { setLang, t } from "../i18n";
import fixture from "./fixtures/session-v2.json";

const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (chunks: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200 });
};
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 };
const done = (u = usage) => ev("done", { usage: u, timings: { first_op_ms: 7, total_ms: 20 }, ops: 1, model: "claude-haiku-5-5" });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean) {
  for (let k = 0; k < 200 && !cond(); k++) await tick();
  expect(cond()).toBe(true);
}

interface Options {
  /** SSE chunks for the i-th request to /api/board. */
  respond?: (i: number, body: any) => string[] | Promise<string[]>;
  saveStatus?: number;
  storage?: Store;
  board?: Board;
  settings?: Partial<Settings>;
}
const open: LiveSession[] = [];
afterEach(() => { open.splice(0).forEach((s) => s.stop()); setLang("en-US"); });

function harness(o: Options = {}) {
  let board = o.board ?? emptyBoard();
  let settings: Settings = { model: "claude-haiku-5-5", shape: "auto", catalogs: [], speechLang: "en-US", ...o.settings };
  const requests: any[] = [];
  const saves: SessionRecord[] = [];
  const storage = o.storage ?? memoryStore();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (url === "/api/sessions") { saves.push(body); return new Response("{}", { status: o.saveStatus ?? 200 }); }
    requests.push(body);
    return sse(await (o.respond ?? (() => [done()]))(requests.length - 1, body));
  }) as unknown as typeof fetch;
  const session = createLiveSession({
    board: { get: () => board, submit: async (ops) => { board = applyOps(board, ops).board; }, clear: () => { board = emptyBoard(); } },
    settings: { get: () => settings, apply: (s) => { settings = { ...settings, ...s }; } },
    storage,
    fetchImpl,
  });
  open.push(session);
  let state!: LiveSessionState;
  session.subscribe((s) => (state = s));
  const say = (text: string) => session.onFinalText(text, { endOfTurn: true });
  return { session, say, requests, saves, storage, board: () => board, state: () => state, settings: () => settings };
}
const settled = (h: ReturnType<typeof harness>, n: number) => until(() => h.state().entries.length === n && !h.state().busy);

describe("requests", () => {
  it("keeps one request in flight and batches the text that arrives meanwhile", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness({
      respond: async (i) => {
        if (i === 0) await gate;
        return [ev("op", { name: "update_summary", input: { text: "r" + i } }), done()];
      },
    });
    h.say("one."); h.say("two."); h.say("three.");
    expect(h.state().busy).toBe(true);
    release();
    await settled(h, 2);
    expect(h.requests.map((b) => b.delta)).toEqual(["one.", "two. three."]);
    expect(h.requests[0].board).toBe("(empty board)");
    expect(h.board().summary).toBe("r1");
    expect(h.state().transcript.map((x) => x.text)).toEqual(["one.", "two.", "three."]);
    expect(h.state().totals.requests).toBe(2);
    expect(h.state().totals.costUsd).toBeCloseTo(2 * costUsd("claude-haiku-5-5", usage), 10);
  });

  it("groups speech results until the turn ends, and sends an instruction after its content", async () => {
    const h = harness();
    h.session.onFinalText("a login page");
    h.session.onFinalText("grafito make it a tree");
    expect(h.requests).toHaveLength(0);
    h.session.onFinalText("", { endOfTurn: true });
    await settled(h, 2);
    expect(h.requests.map((b) => [b.mode, b.delta])).toEqual([["content", "a login page"], ["instruction", "make it a tree"]]);
  });

  it("sends the settings: model, shape, language, and catalogs, which also decide the service in the board text", async () => {
    const { board } = applyOps(emptyBoard(), [
      { name: "create_zone", input: { id: "z", kind: "flow", title: "Z" } },
      { name: "add_step", input: { zone: "z", id: "fn", label: "Function", service: "lambda" } },
    ]);
    const off = harness({ board });
    off.say("one."); await settled(off, 1);
    const on = harness({ board, settings: { catalogs: ["aws"], model: "claude-sonnet-5-5", shape: "tree", speechLang: "es-MX" } });
    on.say("two."); await settled(on, 1);
    expect(off.requests[0]).toMatchObject({ catalogs: [], model: "claude-haiku-5-5", shape: "auto", lang: "en-US" });
    expect(off.requests[0].board).not.toContain("service:");
    expect(on.requests[0]).toMatchObject({ catalogs: ["aws"], model: "claude-sonnet-5-5", shape: "tree", lang: "es-MX" });
    expect(on.requests[0].board).toContain(" service:lambda");
  });
});

describe("snapshot", () => {
  it("records every request with its full batch, ops, warnings, usage and error", async () => {
    const long = "x".repeat(200);
    const h = harness({
      settings: { shape: "flow", speechLang: "es-CL" },
      respond: (i) => i === 0
        ? [ev("op", { name: "update_summary", input: { text: "r" } }), ev("op", { invalid: true, name: "zz", warning: "zz: bad" }), done()]
        : [ev("error", { message: "Error calling Claude: boom" })],
    });
    h.say(long); await settled(h, 1);
    h.say("second"); await settled(h, 2);
    const rec = h.session.snapshot();
    expect(rec).toMatchObject({ version: 2, shape: "flow", speechLang: "es-CL", model: "claude-haiku-5-5", summary: "r" });
    expect(rec.requests[0]).toMatchObject({
      n: 1, promptVersion: PROMPT_VERSION, batch: long, mode: "content", firstOpMs: 7,
      ops: [{ name: "update_summary", input: { text: "r" } }], warnings: ["zz: bad"],
      usage: { input: 1000, cacheRead: 500, cacheWrite: 100, output: 200 },
    });
    expect(rec.requests[0].error).toBeUndefined();
    expect(rec.requests[1].error).toContain("boom");
    expect(rec.totals).toEqual({ requests: 1, costUsd: rec.requests[0].costUsd, medianVoiceFirstMs: rec.requests[0].voiceFirstMs });
    expect(rec.transcript.map((x) => x.text)).toEqual([long, "second"]);
    expect(parseRecord(JSON.parse(JSON.stringify(rec))).ok).toBe(true);
  });
});

describe("restore", () => {
  it("round trip: parseRecord → restore → snapshot gives the fixture back", () => {
    const p = parseRecord(fixture);
    if (!p.ok) throw new Error(p.error);
    const h = harness();
    h.session.restore(p.record);
    const { updatedAt: _a, ...back } = h.session.snapshot();
    const { updatedAt: _b, ...expected } = fixture;
    expect(back).toEqual(expected);
    // The undone instruction is not replayed; catalog ops are, with every catalog on.
    expect(h.board().zones.map((z) => z.id)).toEqual(["orders"]);
    expect(h.board().elements.find((e) => e.id === "ship")?.service).toBe("aws:lambda");
    expect(h.settings()).toMatchObject({ model: "claude-sonnet-5-5", shape: "auto", speechLang: "en-US" });
    expect(h.state().canUndo).toBe(false);
  });

  it("continues the numbering and the totals after the record", async () => {
    const h = harness();
    const p = parseRecord(fixture);
    if (!p.ok) throw new Error(p.error);
    h.session.restore(p.record);
    h.say("more"); await settled(h, 5);
    const rec = h.session.snapshot();
    expect(rec.requests[4].n).toBe(5);
    expect(rec.totals.requests).toBe(4);
    expect(rec.id).toBe(fixture.id);
  });

  it("parses the recorded ops: invalid ones are dropped and join the warnings", () => {
    const rec = structuredClone(fixture) as SessionRecord;
    rec.requests = [{
      ...rec.requests[0],
      warnings: ["zz: bad"],
      ops: [
        { name: "create_zone", input: { id: "z", kind: "flow", title: "Z" } },
        { name: "add_mark", input: { zone: "e", id: "m", at: 500, label: "x" } },
        { name: "nothing", input: {} },
      ],
    }];
    const h = harness();
    h.session.restore(rec);
    const [e] = h.state().entries;
    expect(e.ops).toBe(1);
    expect(e.warnings[0]).toBe("zz: bad");
    expect(e.warnings.slice(1).map((w) => w.split(":")[0])).toEqual(["add_mark", "nothing"]);
  });

  it("rejects a version 1 record with a clear message", () => {
    expect(parseRecord({ ...fixture, version: 1 })).toEqual({ ok: false, error: OUTDATED_RECORD, outdated: true });
  });
});

describe("undo", () => {
  it("rebuilds the board without the last applied instruction", async () => {
    const h = harness({
      respond: (i) => [ev("op", i === 0
        ? { name: "create_zone", input: { id: "a", kind: "flow", title: "A" } }
        : { name: "create_zone", input: { id: "b", kind: "list", title: "B" } }), done()],
    });
    h.say("content"); await settled(h, 1);
    h.say("grafito add a list"); await settled(h, 2);
    expect(h.board().zones.map((z) => z.id)).toEqual(["a", "b"]);
    expect(h.state().canUndo).toBe(true);
    expect(h.session.undoLastInstruction()).toBe(true);
    expect(h.board().zones.map((z) => z.id)).toEqual(["a"]);
    expect(h.state().entries[1].undone).toBe(true);
    expect(h.session.undoLastInstruction()).toBe(false);
    expect(h.session.snapshot().requests[1].undone).toBe(true);
  });
});

describe("autosave", () => {
  it("saves to storage and the server shortly after a request ends", async () => {
    const h = harness();
    h.say("one."); await settled(h, 1);
    await until(() => h.saves.length === 1);
    expect(h.saves[0].requests[0].batch).toBe("one.");
    expect(parseRecord(JSON.parse(h.storage.get(RECORD_KEY)!)).ok).toBe(true);
    expect(h.state().savedAt).not.toBeNull();
    expect(h.state().warning).toBe("");
  });

  it("warns when the server does not save", async () => {
    const h = harness({ saveStatus: 500 });
    h.say("one."); await settled(h, 1);
    await until(() => h.state().warning !== "");
    expect(h.state().warning).toBe(t("save.failed", { error: "HTTP 500" }));
    expect(h.storage.get(RECORD_KEY)).not.toBeNull();
  });

  it("offers the stored session until the first request, and reset forgets it", async () => {
    const storage = memoryStore({ [RECORD_KEY]: JSON.stringify(fixture) });
    const h = harness({ storage });
    expect(h.state().unclosed?.id).toBe(fixture.id);
    h.say("one."); await settled(h, 1);
    expect(h.state().unclosed).toBeNull();
    h.session.reset();
    expect(storage.get(RECORD_KEY)).toBeNull();
    expect(h.state()).toMatchObject({ entries: [], transcript: [], unclosed: null, totals: { requests: 0, usage: zeroUsage(), costUsd: 0 } });
    expect(h.session.snapshot().id).not.toBe(fixture.id);
  });

  it("drops a stored version 1 session with the outdated message", () => {
    const storage = memoryStore({ [RECORD_KEY]: JSON.stringify({ ...fixture, version: 1 }) });
    const h = harness({ storage });
    expect(h.state().unclosed).toBeNull();
    expect(h.state().warning).toBe(t("record.outdated"));
    expect(storage.get(RECORD_KEY)).toBeNull();
  });
});
