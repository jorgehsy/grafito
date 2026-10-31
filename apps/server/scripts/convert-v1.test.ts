import { describe, expect, it } from "vitest";
import { convertV1 } from "./convert-v1";

const v1 = {
  version: 1, id: "abc", startedAt: 1, updatedAt: 2, model: "m", lang: "es-CL",
  requests: [
    { n: 1, model: "m", text: "hola", startedAt: 1, firstOpMs: 5, voiceFirstMs: null, totalMs: 9,
      ops: [{ name: "update_summary", input: { text: "s" } }], invalid: ["x: bad"], usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, costUsd: 0.1 },
    { n: 2, model: "m", text: "árbol", mode: "instruction", undone: true, startedAt: 2, firstOpMs: null, voiceFirstMs: null, totalMs: null,
      ops: [], invalid: [], usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, costUsd: 0, error: "HTTP 500" },
  ],
  transcript: [{ text: "hola", at: 1 }], summary: "s", totals: { requests: 2, costUsd: 0.1, medianVoiceFirstMs: null },
};

describe("convertV1", () => {
  it("renames the fields, fills the defaults and stamps prompt version 1", () => {
    const r = convertV1(v1);
    expect(r).toMatchObject({ version: 2, id: "abc", shape: "auto", speechLang: "es-CL", summary: "s" });
    expect(r.requests[0]).toMatchObject({ n: 1, promptVersion: 1, batch: "hola", mode: "content", warnings: ["x: bad"], firstOpMs: 5 });
    expect(r.requests[1]).toMatchObject({ batch: "árbol", mode: "instruction", undone: true, error: "HTTP 500" });
    expect(r.requests[0]).not.toHaveProperty("text");
    expect(r).not.toHaveProperty("lang");
  });
  it("keeps a recorded shape", () => {
    expect(convertV1({ ...v1, shape: "flow" }).shape).toBe("flow");
  });
  it("rejects other versions and broken records", () => {
    expect(() => convertV1({ ...v1, version: 2 })).toThrow(/version 1/);
    expect(() => convertV1({ ...v1, requests: [{ n: 1 }] })).toThrow(/^requests\.0\./);
  });
});
