import { describe, expect, it } from "vitest";
import { OUTDATED_RECORD, parseRecord } from "./record";

const record = (extra: object = {}) => ({
  version: 2, id: "abc", startedAt: 1, updatedAt: 2, model: "m", shape: "auto", speechLang: "en-US",
  requests: [{
    n: 1, model: "m", promptVersion: 1, batch: "t", mode: "content", startedAt: 1, firstOpMs: null, voiceFirstMs: null, totalMs: 3,
    ops: [{ name: "update_summary", input: { text: "s" } }], warnings: [], usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, costUsd: 0,
  }],
  transcript: [{ text: "t", at: 1 }], summary: "s", totals: { requests: 1, costUsd: 0, medianVoiceFirstMs: null },
  ...extra,
});

describe("parseRecord", () => {
  it("accepts a version 2 record", () => {
    const p = parseRecord(record());
    expect(p.ok && p.record.requests[0].batch).toBe("t");
  });
  it("rejects version 1 with the outdated message", () => {
    expect(parseRecord({ version: 1, id: "abc", requests: [], transcript: [] })).toEqual({ ok: false, error: OUTDATED_RECORD, outdated: true });
  });
  it("rejects anything else, naming the first bad field", () => {
    for (const x of [null, "x", [], { version: 3 }, record({ id: "../x" }), record({ requests: "no" })]) {
      const p = parseRecord(x);
      expect(p.ok).toBe(false);
      expect(!p.ok && p.outdated).toBe(false);
    }
    const p = parseRecord(record({ speechLang: 5 }));
    expect(!p.ok && p.error).toMatch(/^speechLang: /);
  });
});
