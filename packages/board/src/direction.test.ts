import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { computeLayout } from "./layout";
import { directionFromShape } from "./layout/elk";
import { applyOps, emptyBoard } from "./model";
import type { Board, ZoneDirection } from "./model";
import { serializeBoard } from "./serialize";

const svc = (id: string): Op => op.add_component({ zone: "z", id, label: id, type: "service" });
const link = (from: string, to: string): Op => op.connect({ id: `${from}_${to}`, from, to });
const board = (direction: ZoneDirection | undefined, ops: Op[]): Board => {
  const r = applyOps(emptyBoard(), [op.create_zone({ id: "z", kind: "system", title: "Z", ...(direction ? { direction } : {}) }), ...ops]);
  expect(r.warnings).toEqual([]);
  return r.board;
};
const chain = ["a", "b", "c", "d"].map(svc).concat([link("a", "b"), link("b", "c"), link("c", "d")]);
const fan = ["api", "w1", "w2", "w3"].map(svc).concat([link("api", "w1"), link("api", "w2"), link("api", "w3")]);

describe("zone direction", () => {
  it("is kept on flow and system zones, shown in the board text, ignored with a warning elsewhere", () => {
    const b = board("vertical", []);
    expect(b.zones[0].direction).toBe("vertical");
    expect(serializeBoard(b)).toContain("direction:vertical");
    const r = applyOps(emptyBoard(), [op.create_zone({ id: "l", kind: "list", title: "L", direction: "vertical" })]);
    expect(r.board.zones[0].direction).toBeUndefined();
    expect(r.warnings).toEqual(["create_zone: direction ignored on a list zone"]);
  });

  it("from the shape: a chain runs left to right, a fan of peers top to bottom", () => {
    expect(directionFromShape(board(undefined, chain).elements, board(undefined, chain).connections)).toBe("RIGHT");
    expect(directionFromShape(board(undefined, fan).elements, board(undefined, fan).connections)).toBe("DOWN");
  });

  it("from the shape: an arrow back to an earlier element does not count as depth", () => {
    const b = board(undefined, [...fan, link("w1", "api")]);
    expect(directionFromShape(b.elements, b.connections)).toBe("DOWN");
  });

  it("Claude's direction wins over the shape: vertical puts peers in a row, horizontal in a column", async () => {
    const v = await computeLayout(board("vertical", chain));
    expect(v.elements.b.y).toBeGreaterThan(v.elements.a.y);
    expect(v.elements.b.x).toBeCloseTo(v.elements.a.x, 0);
    const h = await computeLayout(board("horizontal", fan));
    expect(h.elements.w1.x).toBeCloseTo(h.elements.w2.x, 0);
    expect(h.elements.w2.y).toBeGreaterThan(h.elements.w1.y);
  });

  it("without a direction a long chain stays horizontal however wide it gets", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const long = [...ids.map(svc), ...ids.slice(1).map((id, i) => link(ids[i], id))];
    const l = await computeLayout(board(undefined, long));
    expect(new Set(ids.map((id) => Math.round(l.elements[id].y))).size).toBe(1);
  });
});
