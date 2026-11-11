import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import { applyOps, emptyBoard, demoTimeline } from "@grafito/board";
import { DEMOS } from "../demos";
import { BUILT_IN, sourceFromRecordText } from "./source";
import { createScriptSketch } from "./sketchStore";

const usage = { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 };
const request = (n: number, batch: string, ops: unknown[]) => ({
  n, model: "m", promptVersion: 1, batch, mode: "content", startedAt: n, firstOpMs: null, voiceFirstMs: null, totalMs: 3, ops, warnings: [], usage, costUsd: 0,
});
const live = (requests: unknown[], summary = "An order flow.") => JSON.stringify({
  version: 3, appMode: "live", id: "abc123", startedAt: 1_700_000_000_000, updatedAt: 2, model: "m", shape: "auto", speechLang: "en-US", summary,
  requests, transcript: [], totals: { requests: requests.length, costUsd: 0, medianVoiceFirstMs: null },
});
const zone = op.create_zone({ id: "z", kind: "flow", title: "Orders" });
const step = (id: string) => op.add_step({ zone: "z", id, label: id });

describe("built-in sources", () => {
  it("are the demos, in order", () => {
    expect(BUILT_IN.map((s) => s.id)).toEqual(DEMOS.map((d) => d.id));
    expect(BUILT_IN.every((s) => !s.replay && !s.architect && s.note === "")).toBe(true);
  });
});

describe("sourceFromRecordText", () => {
  it("opens an exported live session as a replay: its requests are the chapters", () => {
    const r = sourceFromRecordText(live([request(1, "an order comes in", [zone, step("a")]), request(2, "then we ship it", [step("b")])]));
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toMatchObject({ id: "session:abc123", description: "An order flow.", replay: true, architect: false, note: "" });
    expect(r.source.name).not.toBe("");
    expect(demoTimeline(r.source.demo).chapters.map((c) => c.title)).toEqual(["an order comes in", "then we ship it"]);
    const board = applyOps(emptyBoard(), r.source.demo.flatMap((c) => c.ops));
    expect(board.warnings).toEqual([]);
    expect(board.board.elements.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("says how many steps when the session has no summary, and notes skipped ops", () => {
    const r = sourceFromRecordText(live([request(1, "hello", [zone, { name: "gone", input: {} }])], ""));
    if (!r.ok) throw new Error(r.error);
    expect(r.source.description).toBe("1 step");
    expect(r.source.note).toMatch(/1 recorded operation/);
  });

  it("opens an architect session with its own apply step", () => {
    const text = JSON.stringify({
      version: 3, appMode: "architect", id: "arc", startedAt: 1, updatedAt: 2, model: "m", speechLang: "en-US", summary: "",
      timeline: [
        { kind: "turn", n: 1, text: "a bucket", model: "m", promptVersion: 1, startedAt: 1, totalMs: 1, ops: [op.propose({ id: "P1", label: "Bucket" }), op.say({ text: "Here." })], warnings: [], usage, costUsd: 0 },
        { kind: "click", type: "accept", proposal: "P1", at: 2 },
      ],
      totals: { requests: 1, costUsd: 0, medianVoiceFirstMs: null },
    });
    const r = sourceFromRecordText(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.source.architect).toBe(true);
    expect(r.source.demo.map((c) => c.text)).toEqual(["a bucket", "(accepts the proposal)"]);
    expect(r.source.demo[0].ops[0]).toMatchObject({ name: "create_zone", input: { title: "Architecture" } });
  });

  it("refuses what is not a session record, an outdated one and an empty one", () => {
    expect(sourceFromRecordText("not json")).toEqual({ ok: false, error: "not a grafito session record" });
    expect(sourceFromRecordText(JSON.stringify({ hello: 1 }))).toEqual({ ok: false, error: "not a grafito session record" });
    expect(sourceFromRecordText(JSON.stringify({ version: 1 }))).toMatchObject({ ok: false, error: expect.stringMatching(/older grafito/) });
    expect(sourceFromRecordText(live([]))).toEqual({ ok: false, error: "this session has nothing to play" });
  });
});

describe("script sketch store", () => {
  const stroke = (id: string) => ({ id, by: "demo", color: "#000", pts: [0, 0, 1, 1] });
  it("shows a frame, tells its subscribers only when it changed, and ignores the pen", () => {
    const s = createScriptSketch();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.show({ strokes: [stroke("a")], draft: stroke("b"), reading: [], key: "k1" });
    s.show({ strokes: [stroke("a")], draft: stroke("b"), reading: [], key: "k1" });
    expect(calls).toBe(1);
    expect(s.strokes().map((x) => x.id)).toEqual(["a"]);
    expect(s.drafts().map((x) => x.id)).toEqual(["b"]);
    s.add(stroke("mine"));
    s.remove(["a"]);
    expect(s.strokes().map((x) => x.id)).toEqual(["a"]);
    s.show(null);
    expect(calls).toBe(2);
    expect(s.strokes()).toEqual([]);
    expect(s.drafts()).toEqual([]);
    off();
    s.show({ strokes: [], draft: null, reading: [], key: "k2" });
    expect(calls).toBe(2);
  });
});
