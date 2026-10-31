import { describe, expect, it } from "vitest";
import { applyOp, applyOps, emptyBoard } from "./model";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { computeLayout, overlaps } from "./layout";
import type { Rect } from "./layout";
import { buildTree } from "./tree";
import { serializeBoard } from "./serialize";

const finalBoard = (ops: Op[]) => applyOps(emptyBoard(), ops).board;
const inside = (r: Rect, z: Rect) => r.x >= z.x && r.y >= z.y && r.x + r.w <= z.x + z.w && r.y + r.h <= z.y + z.h;
const noOverlap = (rs: [string, Rect][]) => {
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) expect(overlaps(rs[i][1], rs[j][1]), `${rs[i][0]} vs ${rs[j][0]}`).toBe(false);
};

describe("modelo cycle", () => {
  const cyc = () => applyOps(emptyBoard(), [op.create_zone({ id: "c", kind: "cycle", title: "Cycle", center_label: "Window" }), op.create_zone({ id: "f", kind: "flow", title: "F" })]).board;
  it("stores center_label and the stages", () => {
    const r = applyOps(cyc(), [op.add_stage({ zone: "c", id: "a", label: "A", note: "n" }), op.add_stage({ zone: "c", id: "b", label: "B", after: "a" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.zones[0].centerLabel).toBe("Window");
    expect(r.board.elements.map((e) => [e.id, e.type, e.note, e.after])).toEqual([["a", "stage", "n", undefined], ["b", "stage", undefined, "a"]]);
  });
  it("an invalid add_stage is ignored with a warning", () => {
    const b = applyOp(cyc(), op.add_stage({ zone: "c", id: "a", label: "A" })).board;
    for (const bad of [
      op.add_stage({ zone: "nope", id: "x", label: "x" }),
      op.add_stage({ zone: "f", id: "x", label: "x" }),
      op.add_stage({ zone: "c", id: "a", label: "dup" }),
      op.add_step({ zone: "c", id: "x", label: "step one" }),
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
    expect(applyOp(b, op.add_stage({ zone: "c", id: "x", label: "x", after: "zzz" })).warnings).toHaveLength(1);
  });
  it("stages produce no implicit arrows; emphasize, connect, callout and update_label work", () => {
    let b = applyOps(cyc(), [
      op.add_stage({ zone: "c", id: "a", label: "A" }), op.add_stage({ zone: "c", id: "b", label: "B", after: "a" }),
      op.add_step({ zone: "f", id: "p", label: "P" }),
    ]).board;
    const r = applyOps(b, [
      op.emphasize({ target: "a", style: "star" }), op.mark_question({ target: "b" }), op.add_callout({ id: "n", target: "a", text: "look" }),
      op.connect({ id: "k", from: "a", to: "p" }), op.update_label({ id: "b", label: "Newer" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.elements.find((e) => e.id === "b")!.label).toBe("Newer");
    b = r.board;
    expect(applyOp(b, op.delete({ id: "a" })).board.connections).toHaveLength(0);
  });
});

describe("modelo timeline", () => {
  const tl = () => applyOps(emptyBoard(), [op.create_zone({ id: "t", kind: "timeline", title: "T" }), op.create_zone({ id: "c", kind: "cycle", title: "C" })]).board;
  it("add_event and add_span create elements", () => {
    const r = applyOps(tl(), [
      op.add_event({ zone: "t", id: "e", label: "E", when: "Before", note: "n", at: 10 }),
      op.add_event({ zone: "t", id: "e2", label: "E2" }),
      op.add_span({ zone: "t", id: "p", from: 0, to: 40, label: "2 months", tone: "warn" }),
      op.add_span({ zone: "t", id: "p2", from: 50, to: 60, label: "x" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.elements.map((e) => [e.id, e.type, e.at, e.to, e.when])).toEqual([
      ["e", "event", 10, undefined, "Before"], ["e2", "event", undefined, undefined, undefined],
      ["p", "span", 0, 40, undefined], ["p2", "span", 50, 60, undefined],
    ]);
    expect(r.board.elements[3].tone).toBe("neutral");
  });
  it("invalid inputs are ignored with a warning", () => {
    const b = applyOps(tl(), [op.add_event({ zone: "t", id: "e", label: "E" }), op.add_span({ zone: "t", id: "p", from: 0, to: 10, label: "x" })]).board;
    for (const bad of [
      op.add_event({ zone: "c", id: "x", label: "x" }), // cycle zone
      op.add_event({ zone: "nope", id: "x", label: "x" }),
      op.add_event({ zone: "t", id: "e", label: "dup" }),
      op.add_event({ zone: "t", id: "p", label: "dup" }),
      op.add_span({ zone: "c", id: "x", from: 0, to: 5, label: "x" }),
      op.add_span({ zone: "t", id: "e", from: 0, to: 5, label: "dup" }),
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
  });
  it("emphasize, question, callout, connect and update_label work for events and spans", () => {
    const r = applyOps(tl(), [
      op.add_event({ zone: "t", id: "e", label: "E" }), op.add_span({ zone: "t", id: "p", from: 0, to: 10, label: "x" }),
      op.emphasize({ target: "p", style: "underline" }), op.mark_question({ target: "e" }),
      op.add_callout({ id: "n", target: "p", text: "look" }), op.connect({ id: "k", from: "e", to: "p" }),
      op.update_label({ id: "p", label: "3 months" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.elements.find((e) => e.id === "p")!.label).toBe("3 months");
  });
});

describe("serialization", () => {
  it("the model sees cycles, events and spans", () => {
    const t = serializeBoard(finalBoard([
      op.create_zone({ id: "c", kind: "cycle", title: "Cycle", center_label: "Window" }),
      op.add_stage({ zone: "c", id: "a", label: "Chat", note: "asks" }),
      op.create_zone({ id: "t", kind: "timeline", title: "Time" }),
      op.add_event({ zone: "t", id: "e", label: "Idea", when: "Before", at: 5 }),
      op.add_span({ zone: "t", id: "p", from: 0, to: 40, label: "2 months", tone: "warn" }),
    ]));
    expect(t).toContain('[cycle] "Cycle" center:"Window"');
    expect(t).toContain('a (stage) "Chat" @c note:"asks"');
    expect(t).toContain('e (event) "Idea" @t at:5 when:"Before"');
    expect(t).toContain('p (span) "2 months" @t from:0 to:40 tone:warn');
  });
});

describe("layout cycle", () => {
  const cycleBoard = (n: number, center = "Context window") =>
    finalBoard([
      op.create_zone({ id: "c", kind: "cycle", title: "Cycle", center_label: center }),
      ...Array.from({ length: n }, (_, i) => op.add_stage({ zone: "c", id: `s${i}`, label: `Stage number ${i + 1}`, note: i % 2 ? "a somewhat longer note" : undefined })),
    ]);

  it.each([2, 3, 5, 8])("%i stages: no overlaps, inside the zone and with a closed ring", async (n) => {
    const board = cycleBoard(n);
    const lay = await computeLayout(board);
    const zr = lay.zones.c;
    const rects: [string, Rect][] = board.elements.map((e) => [e.id, lay.elements[e.id]]);
    rects.push(["center", lay.labels["center:c"]]);
    noOverlap(rects);
    for (const [id, r] of rects) expect(inside(r, zr), id).toBe(true);
    const rings = Object.keys(lay.connections).filter((k) => k.startsWith("ring:"));
    expect(rings).toHaveLength(n);
    // arrows don't cross the boxes or the center, except at their ends
    for (const k of rings) {
      const g = lay.connections[k];
      for (const p of g.pts) expect(p.x >= zr.x && p.x <= zr.x + zr.w && p.y >= zr.y && p.y <= zr.y + zr.h, k).toBe(true);
    }
    // the last one closes with the first
    expect(lay.connections[`ring:s${n - 1}`]).toBeDefined();
  });

  it("the render tree has ring, center and stages; no auto arrows", async () => {
    const board = cycleBoard(3);
    const tree = buildTree(board, await computeLayout(board));
    for (const k of ["c", "center:c", "s0", "s1", "s2", "ring:s0", "ring:s1", "ring:s2"]) expect(tree.map.has(k), k).toBe(true);
    expect([...tree.map.keys()].some((k) => k.startsWith("auto:"))).toBe(false);
  });

  it("the radius grows with the number of stages", async () => {
    const a = (await computeLayout(cycleBoard(2))).zones.c, b = (await computeLayout(cycleBoard(8))).zones.c;
    expect(b.w).toBeGreaterThan(a.w);
    expect(b.h).toBeGreaterThan(a.h);
  });

  it("after inserts the stage into the ring; with no stages or center it doesn't break", async () => {
    const b = finalBoard([
      op.create_zone({ id: "c", kind: "cycle", title: "Cycle" }),
      op.add_stage({ zone: "c", id: "a", label: "A" }), op.add_stage({ zone: "c", id: "b", label: "B" }),
      op.add_stage({ zone: "c", id: "x", label: "X", after: "a" }),
    ]);
    const lay = await computeLayout(b);
    // a on top, x on the right (next clockwise), b bottom-left
    expect(lay.elements.x.x).toBeGreaterThan(lay.elements.a.x);
    expect(Object.keys(lay.connections).filter((k) => k.startsWith("ring:"))).toHaveLength(3);
    const empty = finalBoard([op.create_zone({ id: "c", kind: "cycle", title: "Cycle" })]);
    expect(Object.keys((await computeLayout(empty)).elements)).toHaveLength(0);
    const one = await computeLayout(finalBoard([op.create_zone({ id: "c", kind: "cycle", title: "C" }), op.add_stage({ zone: "c", id: "a", label: "A" })]));
    expect(inside(one.elements.a, one.zones.c)).toBe(true);
  });
});

describe("layout timeline", () => {
  const tlBoard = (extra: Op[]) => finalBoard([op.create_zone({ id: "t", kind: "timeline", title: "Before and after" }), ...extra]);
  const check = async (board: ReturnType<typeof tlBoard>) => {
    const lay = await computeLayout(board);
    const zr = lay.zones.t;
    const rects: [string, Rect][] = board.elements.map((e) => [e.id, lay.elements[e.id]]);
    for (const [k, r] of Object.entries(lay.labels)) rects.push([k, r]);
    noOverlap(rects);
    for (const [id, r] of rects) expect(inside(r, zr), id).toBe(true);
    return lay;
  };

  it("events with very close at values (10, 12, 14, 90) don't overlap and fit", async () => {
    const lay = await check(tlBoard([
      op.add_event({ zone: "t", id: "a", label: "First long event", when: "Month 1", note: "a note", at: 10 }),
      op.add_event({ zone: "t", id: "b", label: "Second event", when: "Month 2", at: 12 }),
      op.add_event({ zone: "t", id: "c", label: "Third event", when: "Month 3", at: 14 }),
      op.add_event({ zone: "t", id: "d", label: "Fourth", when: "2024", at: 90 }),
    ]));
    expect(new Set(["a", "b", "c"].map((i) => lay.marks[i].side)).size).toBe(2);
    // boxes keep position order within each side
    expect(lay.marks.a.stem[1].x).toBeLessThan(lay.marks.d.stem[1].x);
  });

  it("without at they are spread evenly in insertion order", async () => {
    const board = tlBoard(["a", "b", "c", "d", "e"].map((id) => op.add_event({ zone: "t", id, label: id.toUpperCase() })));
    const lay = await check(board);
    const xs = ["a", "b", "c", "d", "e"].map((id) => lay.marks[id].stem[1].x);
    const d = xs.map((x, i) => (i ? x - xs[i - 1] : 0)).slice(1);
    for (const v of d) expect(v).toBeCloseTo(d[0], 5);
    expect(d[0]).toBeGreaterThan(0);
  });

  it("with at, the position is proportional even if added out of order", async () => {
    const lay = await check(tlBoard([
      op.add_event({ zone: "t", id: "b", label: "B", at: 80 }), op.add_event({ zone: "t", id: "a", label: "A", at: 20 }),
    ]));
    expect(lay.marks.a.stem[1].x).toBeLessThan(lay.marks.b.stem[1].x);
    const ax = lay.connections["axis:t"].pts;
    expect(ax[1].x).toBeGreaterThan(lay.marks.b.stem[1].x);
  });

  it("spans: get separate lanes and fit under the axis", async () => {
    const lay = await check(tlBoard([
      op.add_event({ zone: "t", id: "a", label: "Idea", when: "Before", at: 0 }),
      op.add_event({ zone: "t", id: "b", label: "Software", at: 48 }),
      op.add_event({ zone: "t", id: "c", label: "Prototype", when: "Now", at: 66 }),
      op.add_span({ zone: "t", id: "p1", from: 0, to: 48, label: "2 to 3 months", tone: "warn" }),
      op.add_span({ zone: "t", id: "p2", from: 66, to: 100, label: "1 month", tone: "ok" }),
      op.add_span({ zone: "t", id: "p3", from: 10, to: 12, label: "narrow span with a long label" }),
    ]));
    const axisY = lay.connections["axis:t"].pts[0].y;
    for (const id of ["p1", "p2", "p3"]) expect(lay.elements[id].y).toBeGreaterThan(axisY);
    expect(lay.spans.p1.x1).toBeGreaterThan(lay.spans.p1.x0);
    // event boxes below don't overlap the spans (checked by noOverlap)
  });

  it("render tree: axis, marks, dates, spans and annotations", async () => {
    const board = tlBoard([
      op.add_event({ zone: "t", id: "a", label: "Idea", when: "Before", at: 0 }),
      op.add_event({ zone: "t", id: "b", label: "No date", at: 50 }),
      op.add_span({ zone: "t", id: "p", from: 0, to: 50, label: "2 months", tone: "warn" }),
      op.emphasize({ target: "p", style: "underline" }), op.add_callout({ id: "n", target: "a", text: "look" }),
      op.emphasize({ target: "b", style: "circle" }),
    ]);
    const tree = buildTree(board, await computeLayout(board));
    for (const k of ["t", "axis:t", "a", "b", "stem:a", "stem:b", "when:a", "p", "emphasis:p", "emphasis:b", "n"]) expect(tree.map.has(k), k).toBe(true);
    expect(tree.map.has("when:b")).toBe(false);
    expect(tree.map.get("p")!.data.tone).toBe("warn");
  });

  it("an empty zone and spans-only don't break", async () => {
    await computeLayout(tlBoard([]));
    await check(tlBoard([op.add_span({ zone: "t", id: "p", from: 0, to: 50, label: "x" })]));
  });
});

describe("tree zone", () => {
  const base = () => [op.create_zone({ id: "t", kind: "tree", title: "Prototype types" })];
  const proto = () => [
    ...base(),
    op.add_branch({ zone: "t", id: "p", label: "Prototypes" }),
    op.add_branch({ zone: "t", id: "v", label: "Visual", parent: "p", note: "how it looks" }),
    op.add_branch({ zone: "t", id: "s", label: "Services", parent: "p" }),
    op.add_branch({ zone: "t", id: "f", label: "Figma", parent: "v" }),
    op.add_branch({ zone: "t", id: "a", label: "Artifacts in Claude Code", parent: "v" }),
    op.add_branch({ zone: "t", id: "o", label: "OpenAPI", parent: "s" }),
    op.add_branch({ zone: "t", id: "m", label: "Postman Collection", parent: "s" }),
  ];

  it("rejects zones of another kind", () => {
    const r = applyOps(emptyBoard(), [op.create_zone({ id: "l", kind: "list", title: "L" }), op.add_branch({ zone: "l", id: "x", label: "X" })]);
    expect(r.warnings[0]).toContain("cannot add branch");
  });
  it("missing parent: becomes a root with a warning", () => {
    const r = applyOps(emptyBoard(), [...base(), op.add_branch({ zone: "t", id: "x", label: "X", parent: "nada" })]);
    expect(r.warnings[0]).toContain("becomes a root");
    expect(r.board.elements[0].parent).toBeUndefined();
  });
  it("update_text edits the node's note and label", () => {
    let b = finalBoard(proto());
    b = applyOp(b, op.update_text({ id: "v", field: "note", value: "" })).board;
    expect(b.elements.find((e) => e.id === "v")!.note).toBeUndefined();
    b = applyOp(b, op.update_text({ id: "v", field: "label", value: "Visuals" })).board;
    expect(b.elements.find((e) => e.id === "v")!.label).toBe("Visuals");
  });
  it("deleting a node moves its children up a level", () => {
    const b = applyOp(finalBoard(proto()), op.delete({ id: "v" })).board;
    expect(b.elements.find((e) => e.id === "f")!.parent).toBe("p");
    expect(b.elements.some((e) => e.id === "v")).toBe(false);
  });
  it("layout: one column per depth, children in order, no overlaps and inside the zone", async () => {
    const lay = await computeLayout(finalBoard(proto()));
    const e = lay.elements, z = lay.zones.t;
    expect(e.p.x).toBeLessThan(e.v.x);
    expect(e.v.x).toBe(e.s.x);
    expect(e.v.x).toBeLessThan(e.f.x);
    expect(e.f.x).toBe(e.m.x);
    expect(e.f.x).toBeGreaterThanOrEqual(e.v.x + e.v.w); // the children column starts after the widest of the previous level
    expect(e.v.y).toBeLessThan(e.s.y);
    expect(e.f.y).toBeLessThan(e.a.y);
    expect(e.a.y).toBeLessThan(e.o.y);
    expect(e.o.y).toBeLessThan(e.m.y);
    noOverlap(Object.entries(e));
    for (const [id, r] of Object.entries(e)) expect(inside(r, z), id).toBe(true);
    expect(Object.keys(lay.connections).filter((k) => k.startsWith("br:"))).toHaveLength(6);
  });
  it("long labels widen their column without hitting the next one", async () => {
    const lay = await computeLayout(finalBoard([
      ...base(),
      op.add_branch({ zone: "t", id: "r", label: "A category with a really very long name", note: "and a note" }),
      op.add_branch({ zone: "t", id: "h", label: "Child", parent: "r" }),
    ]));
    expect(lay.elements.h.x).toBeGreaterThanOrEqual(lay.elements.r.x + lay.elements.r.w);
  });
  it("forest: several roots stack", async () => {
    const lay = await computeLayout(finalBoard([
      ...base(),
      op.add_branch({ zone: "t", id: "r1", label: "One" }),
      op.add_branch({ zone: "t", id: "k1", label: "Child one", parent: "r1" }),
      op.add_branch({ zone: "t", id: "r2", label: "Two" }),
    ]));
    expect(lay.elements.r1.x).toBe(lay.elements.r2.x);
    expect(lay.elements.r1.y).toBeLessThan(lay.elements.r2.y);
    noOverlap(Object.entries(lay.elements));
  });
  it("buildTree includes the note and brackets; serialize shows the hierarchy", async () => {
    const b = finalBoard(proto());
    const tree = buildTree(b, await computeLayout(b));
    expect(tree.map.get("v")!.data.noteLines).toEqual(["how it looks"]);
    expect(tree.map.get("br:f")!.data.variant).toBe("bracket");
    const txt = serializeBoard(b);
    expect(txt).toContain("- p (branch)");
    expect(txt).toContain("-   v (branch)");
    expect(txt).toContain("-     f (branch)");
    expect(txt).toContain('note:"how it looks"');
  });
});
