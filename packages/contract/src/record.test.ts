import { describe, expect, it } from "vitest";
import { OUTDATED_RECORD, parseRecord } from "./record";

const v2 = (extra: object = {}) => ({
  version: 2, id: "abc", startedAt: 1, updatedAt: 2, model: "m", shape: "auto", speechLang: "en-US",
  requests: [{
    n: 1, model: "m", promptVersion: 1, batch: "t", mode: "content", startedAt: 1, firstOpMs: null, voiceFirstMs: null, totalMs: 3,
    ops: [{ name: "update_summary", input: { text: "s" } }], warnings: [], usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, costUsd: 0,
  }],
  transcript: [{ text: "t", at: 1 }], summary: "s", totals: { requests: 1, costUsd: 0, medianVoiceFirstMs: null },
  ...extra,
});

const turn = (n: number, extra: object = {}) => ({
  kind: "turn", n, text: "a bucket", model: "m", promptVersion: 1, startedAt: n, totalMs: 9,
  ops: [{ name: "say", input: { text: "Done." } }], warnings: [], usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, costUsd: 0.5,
  ...extra,
});
const architect = (extra: object = {}) => ({
  version: 3, appMode: "architect", id: "arc", startedAt: 1, updatedAt: 2, model: "m", speechLang: "en-US", summary: "",
  timeline: [turn(1), { kind: "click", type: "accept", proposal: "P1", at: 5 }, turn(2, { error: "HTTP 500" })],
  totals: { requests: 2, costUsd: 1, medianVoiceFirstMs: null },
  ...extra,
});

describe("parseRecord", () => {
  it("reads a version 2 record as a version 3 live record", () => {
    const p = parseRecord(v2());
    if (!p.ok) throw new Error(p.error);
    expect(p.record).toEqual({ ...v2(), version: 3, appMode: "live" });
  });
  it("accepts a version 3 live record", () => {
    const p = parseRecord({ ...v2(), version: 3, appMode: "live" });
    expect(p.ok && p.record.appMode === "live" && p.record.requests[0].batch).toBe("t");
  });
  it("accepts a version 3 architect record: turns and clicks in order", () => {
    const p = parseRecord(architect());
    if (!p.ok || p.record.appMode !== "architect") throw new Error("not an architect record");
    expect(p.record.timeline.map((e) => e.kind)).toEqual(["turn", "click", "turn"]);
    expect(p.record.timeline[2]).toMatchObject({ kind: "turn", error: "HTTP 500" });
  });
  it("an architect turn may carry its sketch in text; a record without one (saved before sketch turns) still parses", () => {
    const p = parseRecord(architect({ timeline: [turn(1, { text: "", sketch: "STROKES (1)\n- s1 box" }), turn(2)] }));
    if (!p.ok || p.record.appMode !== "architect") throw new Error("not an architect record");
    expect(p.record.timeline[0]).toMatchObject({ kind: "turn", text: "", sketch: "STROKES (1)\n- s1 box" });
    expect(p.record.timeline[1]).not.toHaveProperty("sketch");
    expect(parseRecord(architect({ timeline: [turn(1, { sketch: 5 })] })).ok).toBe(false);
  });
  it("rejects version 1 with the outdated message", () => {
    expect(parseRecord({ version: 1, id: "abc", requests: [], transcript: [] })).toEqual({ ok: false, error: OUTDATED_RECORD, outdated: true });
  });
  it("rejects anything else, naming the first bad field", () => {
    for (const x of [
      null, "x", [], { version: 3 }, { version: 4 }, v2({ id: "../x" }), v2({ requests: "no" }), { ...v2(), version: 3 },
      architect({ appMode: "draw" }), architect({ version: 2 }), architect({ timeline: [{ kind: "click", type: "maybe", proposal: "P", at: 1 }] }),
      architect({ totals: { requests: 0, costUsd: 0, medianVoiceFirstMs: 5 } }), v2({ appMode: "architect", version: 3 }),
    ]) {
      const p = parseRecord(x);
      expect(p.ok).toBe(false);
      expect(!p.ok && p.outdated).toBe(false);
    }
    const p = parseRecord(v2({ speechLang: 5 }));
    expect(!p.ok && p.error).toMatch(/^speechLang: /);
  });
});
