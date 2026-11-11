import { describe, expect, it } from "vitest";
import { op, parseRecord } from "@grafito/contract";
import type { SessionRecord } from "@grafito/contract";
import { applyArchitectOp, architectZoneOp, ARCHITECT_ZONE_ID } from "./architect";
import { applyOps, emptyBoard } from "./model";
import { demoTimeline } from "./demo-timeline";
import { recordToDemo } from "./replay";

const usage = { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 };
const request = (n: number, batch: string, ops: unknown[], extra: object = {}) => ({
  n, model: "m", promptVersion: 1, batch, mode: "content", startedAt: n, firstOpMs: null, voiceFirstMs: null, totalMs: 3, ops, warnings: [], usage, costUsd: 0, ...extra,
});
const parsed = (x: unknown): SessionRecord => {
  const p = parseRecord(x);
  if (!p.ok) throw new Error(p.error);
  return p.record;
};
const live = (requests: unknown[]) => parsed({
  version: 3, appMode: "live", id: "abc", startedAt: 1, updatedAt: 2, model: "m", shape: "auto", speechLang: "en-US", summary: "s",
  requests, transcript: [], totals: { requests: requests.length, costUsd: 0, medianVoiceFirstMs: null },
});
const zone = op.create_zone({ id: "z", kind: "flow", title: "Orders" });
const node = (id: string) => op.add_step({ zone: "z", id, label: id });

describe("recordToDemo, live record", () => {
  const rec = live([
    request(1, "an order comes in and we check the stock", [zone, node("a"), node("b")]),
    request(2, "make it red", [node("oops")], { mode: "instruction", undone: true }),
    request(3, "(sketch)", [node("c"), { name: "no_such_op", input: {} }], { mode: "sketch" }),
    request(4, "  ", []),
    request(5, "nothing to draw here", []),
  ]);
  const r = recordToDemo(rec);

  it("makes one chunk and one chapter per kept request, with its batch as the subtitle", () => {
    expect(r.opSet).toBe("board");
    expect(r.demo.map((c) => c.text)).toEqual(["an order comes in and we check the stock", "(sketch)", "nothing to draw here"]);
    const tl = demoTimeline(r.demo);
    expect(tl.chapters.map((c) => c.title)).toEqual(["an order comes in and we check the stock", "(sketch)", "nothing to draw here"]);
    for (let i = 1; i < r.demo.length; i++) expect(r.demo[i].at_ms).toBeGreaterThan(r.demo[i - 1].at_ms);
  });

  it("keeps the ops in order, leaves out undone requests and counts ops that no longer parse", () => {
    expect(r.demo.map((c) => c.ops)).toEqual([[zone, node("a"), node("b")], [node("c")], []]);
    expect(r.dropped).toBe(1);
    const board = applyOps(emptyBoard(), r.demo.flatMap((c) => c.ops));
    expect(board.warnings).toEqual([]);
    expect(board.board.elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("an empty record is an empty demo", () => {
    expect(recordToDemo(live([])).demo).toEqual([]);
  });

  it("reads a version 2 record too", () => {
    const v2 = parsed({
      version: 2, id: "old", startedAt: 1, updatedAt: 2, model: "m", shape: "auto", speechLang: "en-US", summary: "",
      requests: [request(1, "hello", [zone])], transcript: [], totals: { requests: 1, costUsd: 0, medianVoiceFirstMs: null },
    });
    expect(recordToDemo(v2).demo.map((c) => c.ops)).toEqual([[zone]]);
  });
});

describe("recordToDemo, architect record", () => {
  const Z = ARCHITECT_ZONE_ID;
  const comp = (id: string, proposal?: string) => op.add_component({ zone: Z, id, label: id, type: "service", ...(proposal ? { proposal } : {}) });
  const turn = (n: number, text: string, ops: unknown[]) => ({ kind: "turn", n, text, model: "m", promptVersion: 1, startedAt: n, totalMs: 1, ops, warnings: [], usage, costUsd: 0 });
  const click = (type: string, proposal: string) => ({ kind: "click", type, proposal, at: 1 });
  const rec = parsed({
    version: 3, appMode: "architect", id: "arc", startedAt: 1, updatedAt: 2, model: "m", speechLang: "en-US", summary: "",
    timeline: [
      turn(1, "a web app with a database", [op.propose({ id: "P1", label: "Web" }), comp("web", "P1"), op.propose({ id: "P2", label: "Db" }), comp("db", "P2"), op.say({ text: "Two ideas." })]),
      click("accept", "P1"),
      click("reject", "P2"),
      turn(2, "add an api", [comp("api"), op.say({ text: "Added." })]),
    ],
    totals: { requests: 2, costUsd: 0, medianVoiceFirstMs: null },
  });
  const r = recordToDemo(rec, { zoneTitle: "Architecture", clickText: (t) => (t === "accept" ? "Keep it" : "Drop it") });

  it("makes a chunk per turn and one per run of clicks; say is not drawn", () => {
    expect(r.opSet).toBe("architect");
    expect(r.dropped).toBe(0);
    expect(r.demo.map((c) => c.text)).toEqual(["a web app with a database", "Keep it, Drop it", "add an api"]);
    expect(r.demo[0].ops[0]).toEqual(architectZoneOp("Architecture"));
    expect(r.demo.flatMap((c) => c.ops).some((o) => o.name === "say")).toBe(false);
    expect(r.demo[1].ops).toEqual([op.accept({ proposal: "P1" }), op.reject({ proposal: "P2" })]);
  });

  it("its ops rebuild the board the session ended with", () => {
    let board = emptyBoard();
    const warnings: string[] = [];
    for (const o of r.demo.flatMap((c) => c.ops)) { const a = applyArchitectOp(board, o); board = a.board; warnings.push(...a.warnings); }
    expect(warnings).toEqual([]);
    expect(board.elements.map((e) => e.id)).toEqual(["web", "api"]);
  });

  it("an architect record with no turns is an empty demo", () => {
    expect(recordToDemo({ ...rec, timeline: [] } as SessionRecord).demo).toEqual([]);
  });
});

import { describe as d2, expect as e2, it as i2 } from "vitest";
import { recordToDemo as r2 } from "./replay";
d2("architect replay: data model and review", () => {
  i2("adds the data zone before the first entity and leaves review ops out", () => {
    const rec: any = {
      version: 3, appMode: "architect", id: "a", startedAt: 0, updatedAt: 0, model: "m", speechLang: "es",
      totals: { requests: 1, costUsd: 0, usage: {} },
      timeline: [{ kind: "turn", n: 1, text: "modelo", model: "m", promptVersion: 6, startedAt: 0, totalMs: 1, usage: {}, costUsd: 0, warnings: [],
        ops: [
          { name: "assess_pillar", input: { pillar: "SEC", status: "gap", note: "x" } },
          { name: "add_entity", input: { zone: "data", id: "users", name: "users" } },
        ] }],
    };
    const ops = r2(rec).demo.flatMap((c: any) => c.ops ?? []);
    const names = ops.map((o: any) => o.name);
    e2(names).not.toContain("assess_pillar");
    e2(names).toContain("add_entity");
    e2(names.filter((n: string) => n === "create_zone").length).toBe(2);
    e2(names.lastIndexOf("create_zone")).toBeLessThan(names.indexOf("add_entity"));
  });
});
