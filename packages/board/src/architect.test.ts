import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op, RecordTurn, TimelineEntry } from "@grafito/contract";
import { ARCHITECT_DATA_ZONE_ID, ARCHITECT_ZONE_ID, applyArchitectOp, architectDataZoneOp, architectZoneOp, lastSay, needsDataZone, replayArchitect } from "./architect";
import { BoardController } from "./controller";
import type { Sink } from "./controller";
import { applyOps, emptyBoard, openProposals } from "./model";

const Z = ARCHITECT_ZONE_ID;
const turn = (n: number, ops: unknown[], extra: Partial<RecordTurn> = {}): TimelineEntry => ({
  kind: "turn", n, text: `turn ${n}`, model: "m", promptVersion: 1, startedAt: n, totalMs: 1,
  ops: ops as RecordTurn["ops"], warnings: [], usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, costUsd: 0, ...extra,
});
const click = (type: "accept" | "reject", proposal: string, at = 0): TimelineEntry => ({ kind: "click", type, proposal, at });
const comp = (id: string, proposal?: string): Op => op.add_component({ zone: Z, id, label: id, type: "service", ...(proposal ? { proposal } : {}) });

describe("architect board", () => {
  it("starts with one system zone that Claude's components can go into", () => {
    const r = applyOps(emptyBoard(), [architectZoneOp("Architecture"), op.add_component({ zone: ARCHITECT_ZONE_ID, id: "bucket", label: "Bucket", type: "storage" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.zones).toEqual([{ id: "system", kind: "system", title: "Architecture", n: 0 }]);
    expect(r.board.elements.map((e) => e.zone)).toEqual(["system"]);
  });
});

describe("applyArchitectOp", () => {
  const start = applyOps(emptyBoard(), [architectZoneOp("A"), comp("api")]).board;

  it("refuses deleting the system zone: every later add would fail", () => {
    const r = applyArchitectOp(start, op.delete({ id: Z }));
    expect(r.board).toBe(start);
    expect(r.warnings).toEqual(["delete: 'system' is the system zone; delete deletes components, groups, connections, entities and relations"]);
    expect(applyArchitectOp(r.board, comp("db")).board.elements.map((e) => e.id)).toEqual(["api", "db"]);
  });

  it("is applyOp for everything else", () => {
    expect(applyArchitectOp(start, op.delete({ id: "api" })).board.elements).toEqual([]);
    expect(applyArchitectOp(start, op.delete({ id: "nope" })).warnings).toEqual(["delete: id 'nope' does not exist"]);
  });

  it("live mode is unchanged: applyOp still deletes a zone", () => {
    expect(applyOps(start, [op.delete({ id: Z })]).board.zones).toEqual([]);
  });

  it("the controller applies with it when asked, as the architect panel does", async () => {
    const noop = async () => {};
    const sink: Sink = { draw: noop, update: noop, ink: noop, remove: noop, move: () => {}, setTarget: () => {} };
    const c = new BoardController(sink);
    const warnings: string[] = [];
    c.onWarnings = (w) => warnings.push(...w);
    await c.submit([architectZoneOp("A"), op.delete({ id: Z }), comp("api")], applyArchitectOp);
    expect(c.board.zones.map((z) => z.id)).toEqual([Z]);
    expect(c.board.elements.map((e) => e.id)).toEqual(["api"]);
    expect(warnings).toHaveLength(1);
  });
});

describe("lastSay", () => {
  it("is the last say of the ops, or null", () => {
    expect(lastSay([op.say({ text: "a" }), comp("x"), op.say({ text: "b", target: "x" })])).toEqual({ text: "b", target: "x" });
    expect(lastSay([comp("x")])).toBeNull();
  });
});

describe("replayArchitect", () => {
  it("makes the system zone, then replays turn ops and clicks in order; say is not drawn", () => {
    const r = replayArchitect([
      turn(1, [op.propose({ id: "P1", label: "Web" }), comp("web", "P1"), op.propose({ id: "P2", label: "Db" }), comp("db", "P2"), op.say({ text: "Two ideas.", target: "P1" })]),
      click("accept", "P1"),
      turn(2, [comp("api"), op.say({ text: "Added." })]),
    ], "Architecture");
    expect(r.warnings).toEqual([]);
    expect(r.boardOps[0]).toEqual(architectZoneOp("Architecture"));
    expect(r.boardOps.some((o) => o.name === "say")).toBe(false);
    expect(r.boardOps.filter((o) => o.name === "accept")).toEqual([op.accept({ proposal: "P1" })]);
    expect(r.board.zones.map((z) => z.id)).toEqual([Z]);
    expect(r.board.elements.map((e) => [e.id, e.proposal])).toEqual([["web", undefined], ["db", "P2"], ["api", undefined]]);
    expect(r.turns.map((t) => t.ops.map((o) => o.name))).toEqual([["propose", "add_component", "propose", "add_component", "say"], ["add_component", "say"]]);
    expect(r.pending).toEqual([]);
  });

  it("gives back the board a live run left: pending proposals stay pencil", () => {
    const ops = [architectZoneOp("A"), op.propose({ id: "P1", label: "Cache" }), comp("cache", "P1"), comp("api")];
    const live = applyOps(emptyBoard(), ops).board;
    const r = replayArchitect([turn(1, ops.slice(1))], "A");
    expect(r.board).toEqual(live);
    expect(openProposals(r.board).map((p) => p.id)).toEqual(["P1"]);
    expect(r.board.elements.find((e) => e.id === "cache")?.proposal).toBe("P1");
  });

  it("keeps the system zone when a turn deleted it, so later adds still land", () => {
    const r = replayArchitect([turn(1, [comp("api"), op.delete({ id: Z })]), turn(2, [comp("db")])], "A");
    expect(r.board.zones.map((z) => z.id)).toEqual([Z]);
    expect(r.board.elements.map((e) => e.id)).toEqual(["api", "db"]);
    expect(r.warnings).toHaveLength(1);
  });

  it("clicks after the last turn are pending: the next turn's actions", () => {
    const r = replayArchitect([
      turn(1, [op.propose({ id: "P1", label: "a" }), comp("a", "P1"), op.propose({ id: "P2", label: "b" }), comp("b", "P2")]),
      click("accept", "P1", 1),
      turn(2, [op.propose({ id: "P3", label: "c" }), comp("c", "P3")]),
      click("reject", "P2", 2),
      click("accept", "P3", 3),
    ], "A");
    expect(r.pending).toEqual([click("reject", "P2", 2), click("accept", "P3", 3)]);
    expect(openProposals(r.board)).toEqual([]);
    expect(r.board.elements.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("replays a broken turn as it is, and drops ops that do not parse with a warning", () => {
    const r = replayArchitect([
      turn(1, [op.propose({ id: "P1", label: "a" }), comp("a", "P1"), { name: "add_component", input: { zone: Z } }, { name: "nothing", input: {} }], { error: "HTTP 500", warnings: ["x: bad"] }),
    ], "A");
    expect(r.turns[0].ops.map((o) => o.name)).toEqual(["propose", "add_component"]);
    expect(r.turns[0].warnings[0]).toBe("x: bad");
    expect(r.turns[0].warnings.slice(1).map((w) => w.split(":")[0])).toEqual(["add_component", "nothing"]);
    expect(r.turns[0].entry.error).toBe("HTTP 500");
    expect(r.board.elements.find((e) => e.id === "a")?.proposal).toBe("P1");
  });

  it("parses ops with every catalog on", () => {
    const r = replayArchitect([turn(1, [op.add_component({ zone: Z, id: "fn", label: "Fn", type: "service", service: "lambda" })])], "A");
    expect(r.turns[0].warnings).toEqual([]);
    expect(r.board.elements[0].service).toBe("aws:lambda");
  });
});

describe("architect board: the data zone", () => {
  const users = op.add_entity({ zone: ARCHITECT_DATA_ZONE_ID, id: "users", name: "users", fields: [{ name: "id", key: "pk" }] });
  const orders = op.add_entity({ zone: ARCHITECT_DATA_ZONE_ID, id: "orders", name: "orders" });

  it("is a data zone under the system zone, which entities and relations go into", () => {
    const r = applyOps(emptyBoard(), [architectZoneOp("A"), architectDataZoneOp("Data model"), users, orders, op.relate({ id: "r1", from: "users", to: "orders", cardinality: "one_to_many" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.zones[1]).toMatchObject({ id: "data", kind: "data", title: "Data model", place: { relation: "below", of: "system" } });
    expect(r.board.elements.map((e) => [e.id, e.zone, e.type])).toEqual([["users", "data", "entity"], ["orders", "data", "entity"]]);
    expect(r.board.connections).toEqual([expect.objectContaining({ id: "r1", cardinality: "one_to_many" })]);
  });

  it("only an entity for the data zone needs it", () => {
    expect(needsDataZone(users)).toBe(true);
    expect(needsDataZone(op.add_entity({ zone: "elsewhere", id: "x", name: "x" }))).toBe(false);
    expect(needsDataZone(comp("api"))).toBe(false);
    expect(needsDataZone(op.set_fields({ id: "users", fields: [] }))).toBe(false);
  });

  it("delete never takes the data zone either; an entity goes like any element", () => {
    const start = applyOps(emptyBoard(), [architectZoneOp("A"), architectDataZoneOp("D"), users]).board;
    const r = applyArchitectOp(start, op.delete({ id: ARCHITECT_DATA_ZONE_ID }));
    expect(r.board).toBe(start);
    expect(r.warnings).toEqual(["delete: 'data' is the data zone; delete deletes components, groups, connections, entities and relations"]);
    expect(applyArchitectOp(start, op.delete({ id: "users" })).board.elements).toEqual([]);
  });

  it("the replay makes the data zone once, before the first entity, with the title it is given", () => {
    const r = replayArchitect([turn(1, [comp("api"), users]), turn(2, [orders])], "Arquitectura", "Modelo de datos");
    expect(r.warnings).toEqual([]);
    expect(r.boardOps.map((o) => o.name)).toEqual(["create_zone", "add_component", "create_zone", "add_entity", "add_entity"]);
    expect(r.board.zones.map((z) => [z.id, z.title])).toEqual([["system", "Arquitectura"], ["data", "Modelo de datos"]]);
    expect(replayArchitect([turn(1, [users])], "A").board.zones[1].title).toBe("Data model");
    expect(replayArchitect([turn(1, [comp("api")])], "A").board.zones).toHaveLength(1);
  });
});

describe("replayArchitect: the review", () => {
  const finding = op.add_finding({ id: "F1", pillar: "REL", severity: "high", text: "One database.", target: "db" });
  it("review ops build the review and never reach the board", () => {
    const r = replayArchitect([
      turn(1, [comp("db"), op.assess_pillar({ pillar: "REL", status: "gap", note: "One of everything." }), finding, op.say({ text: "One database. (REL10-BP01)", target: "db" })]),
      turn(2, [comp("standby"), op.resolve_finding({ id: "F1" }), op.resolve_finding({ id: "F9" })]),
    ], "A");
    expect(r.boardOps.map((o) => o.name)).toEqual(["create_zone", "add_component", "add_component"]);
    expect(r.warnings).toEqual([]);
    expect(r.review.pillars).toEqual([{ pillar: "REL", status: "gap", note: "One of everything." }]);
    expect(r.review.findings).toEqual([{ id: "F1", pillar: "REL", severity: "high", text: "One database.", target: "db", open: false }]);
    expect(r.turns[0].ops.map((o) => o.name)).toEqual(["add_component", "assess_pillar", "add_finding", "say"]);
    expect(r.turns[1].warnings).toEqual(["resolve_finding: finding 'F9' does not exist"]);
  });
  it("a record saved before the review existed replays with an empty review", () => {
    expect(replayArchitect([turn(1, [comp("api")])], "A").review).toEqual({ pillars: [], findings: [] });
  });
});
