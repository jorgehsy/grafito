import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { ARCHITECT_ZONE_ID, architectZoneOp } from "./architect";
import { computeLayout } from "./layout";
import type { BoardLayout, Rect } from "./layout";
import { layoutElk } from "./layout/elk";
import { groupHeaderRect, groupMinSize, labelRect } from "./layout/geometry";
import { applyOps, emptyBoard } from "./model";
import type { Board } from "./model";
import { buildTree } from "./tree";

const Z = ARCHITECT_ZONE_ID;
const comp = (id: string, parent?: string, type: "service" | "database" | "actor" = "database"): Op =>
  op.add_component({ zone: Z, id, label: id, type, ...(parent ? { parent } : {}) });
const board = (ops: Op[]): Board => {
  const r = applyOps(emptyBoard(), [architectZoneOp("Architecture"), ...ops]);
  expect(r.warnings).toEqual([]);
  return r.board;
};
const contains = (outer: Rect, inner: Rect, m = 0) =>
  inner.x >= outer.x + m - 0.5 && inner.y >= outer.y + m - 0.5 && inner.x + inner.w <= outer.x + outer.w - m + 0.5 && inner.y + inner.h <= outer.y + outer.h - m + 0.5;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every box sits inside its parent's box (below the header) and inside the zone; siblings never overlap. */
function checkNesting(b: Board, lay: BoardLayout) {
  const rect = (id: string) => lay.groups[id] ?? lay.elements[id];
  const kids = new Map<string | undefined, string[]>();
  for (const g of b.groups) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g.id]);
  for (const e of b.elements) if (e.zone === Z) kids.set(e.group, [...(kids.get(e.group) ?? []), e.id]);
  for (const [parent, ids] of kids) {
    const outer = parent ? lay.groups[parent] : lay.zones[Z];
    for (const id of ids) {
      expect(rect(id), id).toBeDefined();
      expect(contains(outer, rect(id)), `${id} inside ${parent ?? "the zone"}`).toBe(true);
      if (parent) expect(overlap(groupHeaderRect(outer, b.groups.find((g) => g.id === parent)!.label), rect(id)), `${id} clear of ${parent}'s header`).toBe(false);
    }
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) expect(overlap(rect(ids[i]), rect(ids[j])), `${ids[i]} vs ${ids[j]}`).toBe(false);
  }
}

describe("compound layout of a system zone with groups", () => {
  it("a VPC with two AZs and a database in each: nested boxes contain their children", async () => {
    const b = board([
      comp("user", undefined, "actor"),
      op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
      op.add_group({ id: "az1", kind: "availability_zone", label: "AZ a", parent: "vpc" }),
      op.add_group({ id: "az2", kind: "availability_zone", label: "AZ b", parent: "vpc" }),
      comp("db1", "az1"),
      comp("db2", "az2"),
      op.connect({ id: "c1", from: "db1", to: "db2", label: "replicates" }),
      op.connect({ id: "c2", from: "user", to: "db1" }),
    ]);
    const lay = await computeLayout(b);
    expect(Object.keys(lay.groups).sort()).toEqual(["az1", "az2", "vpc"]);
    checkNesting(b, lay);
  });

  it("arrows crossing group borders are routed from one component to the other", async () => {
    const b = board([
      comp("api", undefined, "service"),
      op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
      op.add_group({ id: "sub", kind: "private_subnet", label: "Private", parent: "vpc" }),
      comp("db", "sub"),
      op.connect({ id: "c", from: "api", to: "db", label: "queries" }),
    ]);
    const lay = await computeLayout(b);
    const g = lay.connections.c;
    expect(g.kind).toBe("poly");
    const near = (p: { x: number; y: number }, r: Rect) => p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2;
    expect(near(g.pts[0], lay.elements.api)).toBe(true);
    expect(near(g.pts.at(-1)!, lay.elements.db)).toBe(true);
    // the label stays off the boxes and off the groups' headers
    const l = labelRect(g.label!);
    for (const r of [lay.elements.api, lay.elements.db, groupHeaderRect(lay.groups.vpc, "VPC"), groupHeaderRect(lay.groups.sub, "Private")]) expect(overlap(l, r)).toBe(false);
  });

  it("an empty group gets its minimum size; groups with content are at least that big", async () => {
    const b = board([op.add_group({ id: "empty", kind: "public_subnet", label: "Public" }), op.add_group({ id: "full", kind: "vpc", label: "VPC" }), comp("db", "full")]);
    const lay = await computeLayout(b);
    for (const g of b.groups) {
      const min = groupMinSize(g);
      expect(lay.groups[g.id].w).toBeGreaterThanOrEqual(min.w - 0.5);
      expect(lay.groups[g.id].h).toBeGreaterThanOrEqual(min.h - 0.5);
    }
    expect(lay.groups.empty.w).toBeCloseTo(groupMinSize(b.groups[0]).w);
    checkNesting(b, lay);
  });

  it("the minimum size holds in both directions (ELK transposes it for DOWN)", async () => {
    const b = board([op.add_group({ id: "empty", kind: "public_subnet", label: "Public" }), op.add_group({ id: "full", kind: "vpc", label: "VPC" }), comp("db", "full")]);
    for (const dir of ["RIGHT", "DOWN"] as const) {
      const z = await layoutElk(b.zones[0], b.elements, [], [], dir, b.groups);
      for (const g of b.groups) {
        expect(z.groups![g.id].w, `${dir} ${g.id}`).toBeGreaterThanOrEqual(groupMinSize(g).w - 0.5);
        expect(z.groups![g.id].h, `${dir} ${g.id}`).toBeGreaterThanOrEqual(groupMinSize(g).h - 0.5);
      }
    }
  });

  it("a board of nothing but one empty group still lays out its zone", async () => {
    const b = board([op.add_group({ id: "g", kind: "generic", label: "On-premises" })]);
    const lay = await computeLayout(b);
    checkNesting(b, lay);
  });

  it("deep nesting, unconnected parts and arrows in every direction stay nested and apart", async () => {
    const b = board([
      op.add_group({ id: "cloud", kind: "aws_cloud", label: "AWS Cloud" }),
      op.add_group({ id: "region", kind: "region", label: "us-east-1", parent: "cloud" }),
      op.add_group({ id: "vpc", kind: "vpc", label: "VPC", parent: "region" }),
      op.add_group({ id: "az1", kind: "availability_zone", label: "AZ a", parent: "vpc" }),
      op.add_group({ id: "az2", kind: "availability_zone", label: "AZ b", parent: "vpc" }),
      op.add_group({ id: "pub1", kind: "public_subnet", label: "Public a", parent: "az1" }),
      op.add_group({ id: "priv1", kind: "private_subnet", label: "Private a", parent: "az1" }),
      op.add_group({ id: "pub2", kind: "public_subnet", label: "Public b", parent: "az2" }),
      op.add_group({ id: "priv2", kind: "private_subnet", label: "Private b", parent: "az2" }),
      comp("user", undefined, "actor"),
      comp("lb1", "pub1", "service"),
      comp("app1", "priv1", "service"),
      comp("app2", "priv2", "service"),
      comp("db1", "priv1"),
      comp("db2", "priv2"),
      comp("s3", "region", "service"),
      comp("alone", "pub2", "service"),
      op.connect({ id: "a", from: "user", to: "lb1" }),
      op.connect({ id: "b", from: "lb1", to: "app1" }),
      op.connect({ id: "c", from: "lb1", to: "app2" }),
      op.connect({ id: "d", from: "app1", to: "db1" }),
      op.connect({ id: "e", from: "app2", to: "db1" }),
      op.connect({ id: "f", from: "db1", to: "db2", label: "replicates" }),
      op.connect({ id: "g", from: "db2", to: "app2" }),
    ]);
    const lay = await computeLayout(b);
    checkNesting(b, lay);
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) expect(lay.connections[id]?.pts.length, id).toBeGreaterThanOrEqual(2);
  });

  it("an arrow from another zone reaches a component inside a group", async () => {
    const b = applyOps(
      board([op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }), comp("db", "vpc")]),
      [op.create_zone({ id: "f", kind: "flow", title: "Steps" }), op.add_step({ zone: "f", id: "s", label: "Save" }), op.connect({ id: "x", from: "s", to: "db" })],
    ).board;
    const lay = await computeLayout(b);
    expect(lay.connections.x.cross).toBe(true);
    checkNesting(b, lay);
  });

  it("a zone without groups is laid out exactly as before (no groups in the result)", async () => {
    const b = board([comp("a", undefined, "service"), comp("b"), op.connect({ id: "c", from: "a", to: "b" })]);
    const lay = await computeLayout(b);
    expect(lay.groups).toEqual({});
  });
});

describe("render items of groups", () => {
  it("one group item per group, before every element, outermost first, with its kind and depth", async () => {
    const b = board([
      op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
      op.add_group({ id: "az1", kind: "availability_zone", label: "AZ a", parent: "vpc" }),
      comp("db1", "az1"),
    ]);
    const lay = await computeLayout(b);
    const { items } = buildTree(b, lay);
    const groups = items.filter((i) => i.kind === "group");
    expect(groups.map((g) => [g.key, g.data.variant, g.data.title, g.data.depth])).toEqual([
      ["vpc", "vpc", "VPC", 0],
      ["az1", "availability_zone", "AZ a", 1],
    ]);
    expect(groups[1].geom).toEqual(lay.groups.az1);
    const firstElement = items.findIndex((i) => i.kind === "element");
    expect(items.findIndex((i) => i.kind === "group")).toBeLessThan(firstElement);
  });
  it("renaming a group changes its signature; moving it does not", async () => {
    const ops = [op.add_group({ id: "vpc", kind: "vpc", label: "VPC" })];
    const a = board(ops), b = board([...ops, op.update_label({ id: "vpc", label: "Main VPC" })]);
    const sig = async (x: Board) => buildTree(x, await computeLayout(x)).map.get("vpc")!.sig;
    expect(await sig(a)).not.toBe(await sig(b));
    const c = board([...ops, comp("db", "vpc")]);
    expect(await sig(c)).toBe(await sig(a));
  });
});
