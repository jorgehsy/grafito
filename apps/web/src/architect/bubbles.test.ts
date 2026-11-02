import { describe, expect, it } from "vitest";
import { ARCHITECT_ZONE_ID, applyOps, architectZoneOp, emptyBoard, lastSay } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import {
  bubbleMarkers, initialBubbleView, isOpen, openBubbles, placeBubble, resolveTarget, tailShape, tailTip, toggleMarker,
  toggleRail, unionRect, withCurrent,
} from "./bubbles";
import type { Rect } from "./bubbles";

const comp = (id: string, proposal?: string) => op.add_component({ zone: ARCHITECT_ZONE_ID, id, label: id, type: "service", ...(proposal ? { proposal } : {}) });
const board = (ops: Op[]) => applyOps(emptyBoard(), [architectZoneOp("Architecture"), ...ops]).board;
const say = (text: string, target?: string): Op => ({ name: "say", input: target ? { text, target } : { text } });

describe("bubble target", () => {
  const b = board([
    comp("api"),
    op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
    op.propose({ id: "P1", label: "Storage" }),
    comp("db", "P1"),
    comp("cache", "P1"),
    op.connect({ id: "c1", from: "db", to: "cache", proposal: "P1" }),
    comp("web"),
    op.connect({ id: "c2", from: "api", to: "web" }),
  ]);

  it("points at a component", () => expect(resolveTarget(b, "api")).toEqual({ kind: "element", keys: ["api"] }));
  it("points at a group", () => expect(resolveTarget(b, "vpc")).toEqual({ kind: "group", keys: ["vpc"] }));
  it("points at a connection", () => expect(resolveTarget(b, "c2")).toEqual({ kind: "connection", keys: ["c2"] }));
  it("points at everything drawn under an open proposal", () =>
    expect(resolveTarget(b, "P1")).toEqual({ kind: "proposal", keys: ["db", "cache", "c1"] }));

  it("is a general bubble with no target, an unknown id or the system zone", () => {
    expect(resolveTarget(b, undefined)).toBeNull();
    expect(resolveTarget(b, "nope")).toBeNull();
    expect(resolveTarget(b, ARCHITECT_ZONE_ID)).toBeNull();
  });

  it("is a general bubble once its target is erased", () => {
    const after = applyOps(b, [op.delete({ id: "api" }), op.reject({ proposal: "P1" })]).board;
    expect(resolveTarget(after, "api")).toBeNull();
    expect(resolveTarget(after, "P1")).toBeNull();
    expect(resolveTarget(after, "db")).toBeNull();
  });

  it("is a general bubble for a proposal that was accepted (its items are ink now, not the proposal)", () => {
    expect(resolveTarget(applyOps(b, [op.accept({ proposal: "P1" })]).board, "P1")).toBeNull();
  });
});

describe("bubble markers", () => {
  const turn = (n: number, ops: Op[], extra: { done?: boolean; error?: string } = {}) => ({ n, ops, done: true, ...extra });

  it("the last say of a turn wins", () => {
    expect(lastSay([say("one"), comp("x"), say("two", "x")])).toEqual({ text: "two", target: "x" });
    expect(lastSay([comp("x")])).toBeNull();
  });

  it("one marker per turn, from the say ops; a turn with no say is a muted marker", () => {
    const markers = bubbleMarkers([
      turn(1, [comp("api"), say("An API.", "api")]),
      turn(2, [say("Which database?", "P1"), op.propose({ id: "P1", label: "DB" })]),
      turn(3, [comp("x")], { error: "overloaded" }),
      turn(4, [say("Who are your users?")]),
    ]);
    expect(markers).toEqual([
      { turn: 1, bubble: { text: "An API.", target: "api" } },
      { turn: 2, bubble: { text: "Which database?", target: "P1" } },
      { turn: 3, bubble: null, error: "overloaded" },
      { turn: 4, bubble: { text: "Who are your users?" } },
    ]);
  });

  it("a turn in flight gets its marker once its bubble arrives", () => {
    expect(bubbleMarkers([turn(1, [say("a")]), turn(2, [], { done: false })])).toHaveLength(1);
    expect(bubbleMarkers([turn(1, [say("a")]), turn(2, [say("b")], { done: false })])).toHaveLength(2);
  });
});

describe("open bubbles", () => {
  const markers = bubbleMarkers([1, 2, 3].map((n) => ({ n, ops: [say(`t${n}`)], done: true })));

  it("only the current turn's bubble is open; past ones are markers", () => {
    const v = withCurrent(initialBubbleView(), 3);
    expect(openBubbles(markers, v).map((m) => m.turn)).toEqual([3]);
  });

  it("a marker reopens its bubble and closes it again; the current marker closes the current bubble", () => {
    let v = toggleMarker(withCurrent(initialBubbleView(), 3), 1);
    expect(openBubbles(markers, v).map((m) => m.turn)).toEqual([3, 1]);
    v = toggleMarker(toggleMarker(v, 1), 3);
    expect(openBubbles(markers, v)).toEqual([]);
  });

  it("the rail shows and hides every past bubble", () => {
    let v = toggleRail(withCurrent(initialBubbleView(), 3));
    expect(openBubbles(markers, v).map((m) => m.turn)).toEqual([3, 2, 1]);
    v = toggleMarker(v, 2);
    expect(isOpen(v, 2)).toBe(false);
    v = toggleRail(v);
    expect(openBubbles(markers, v).map((m) => m.turn)).toEqual([3]);
  });

  it("a new turn shrinks reopened bubbles back to markers", () => {
    const v = withCurrent(toggleMarker(withCurrent(initialBubbleView(), 2), 1), 3);
    expect(v.toggled).toEqual([]);
    expect(openBubbles(markers, v).map((m) => m.turn)).toEqual([3]);
  });

  it("a muted marker opens nothing", () => {
    const m = bubbleMarkers([{ n: 1, ops: [], done: true }, { n: 2, ops: [say("b")], done: true }]);
    expect(openBubbles(m, toggleRail(withCurrent(initialBubbleView(), 2))).map((x) => x.turn)).toEqual([2]);
  });
});

describe("bubble placement", () => {
  const screen = { w: 1400, h: 850 };
  const size = { w: 300, h: 90 };
  const box = (p: { x: number; y: number }): Rect => ({ ...p, ...size });
  const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= screen.w && r.y + r.h <= screen.h;

  it("sits beside the target without covering it", () => {
    const t = { x: 500, y: 400, w: 140, h: 70 };
    const r = box(placeBubble(size, t, screen, []));
    expect(hits(r, t)).toBe(false);
    expect(inside(r)).toBe(true);
  });

  it("stays on screen next to an edge", () => {
    const t = { x: 1300, y: 10, w: 90, h: 60 };
    const r = box(placeBubble(size, t, screen, []));
    expect(inside(r)).toBe(true);
    expect(hits(r, t)).toBe(false);
  });

  it("keeps clear of the ✓/✗ toolbar and the text box", () => {
    const t = { x: 500, y: 400, w: 140, h: 70 };
    const avoid = [{ x: 620, y: 360, w: 72, h: 36 }, { x: 0, y: 380, w: 1400, h: 140 }, { x: 640, y: 300, w: 400, h: 200 }];
    const r = box(placeBubble(size, t, screen, avoid));
    expect(hits(r, t)).toBe(false);
    for (const a of avoid) expect(hits(r, a)).toBe(false);
  });

  it("covers other components only when there is no better spot", () => {
    const t = { x: 500, y: 400, w: 140, h: 70 };
    const right = box(placeBubble(size, t, screen, []));
    const r = box(placeBubble(size, t, screen, [], [{ ...right, w: right.w + 40 }]));
    expect(hits(r, right)).toBe(false);
    expect(hits(r, t)).toBe(false);
  });

  it("a general bubble takes the top-right corner, or the next free spot below it", () => {
    expect(placeBubble(size, null, screen, [])).toEqual({ x: 1400 - 300 - 12, y: 12 });
    const taken = { x: 1088, y: 12, w: 300, h: 90 };
    const next = placeBubble(size, null, screen, [taken]);
    expect(next.x).toBe(1088);
    expect(next.y).toBeGreaterThanOrEqual(102);
    expect(next.y).toBeLessThan(140);
  });

  it("the tail aims at a proposal's middle, or at the nearest side of one item", () => {
    const t = { x: 100, y: 100, w: 200, h: 100 };
    // aimed at the middle (200, 150) from the bubble's centre (550, 145), stopping just inside the box
    const p = tailTip("proposal", t, { x: 400, y: 100, w: 300, h: 90 });
    expect(p.x).toBeGreaterThan(280);
    expect(p.x).toBeLessThan(300);
    expect((p.y - 145) / (p.x - 550)).toBeCloseTo((150 - 145) / (200 - 550));
    // a small proposal, or a bubble over it: the middle itself
    expect(tailTip("proposal", { x: 100, y: 100, w: 20, h: 20 }, { x: 140, y: 100, w: 300, h: 90 })).toEqual({ x: 110, y: 110 });
    const tip = tailTip("element", t, { x: 400, y: 100, w: 300, h: 90 });
    expect(tip.x).toBe(304);
    expect(tip.y).toBeCloseTo(145);
  });

  it("the tail leaves the side of the bubble that faces the tip", () => {
    const b = { x: 400, y: 100, w: 300, h: 90 };
    const left = tailShape(b, { x: 304, y: 145 })!;
    expect(left.points[2]).toEqual([-96, 45]);
    expect(left.cover[0]).toBe(0);
    const below = tailShape(b, { x: 550, y: 260 })!;
    expect(below.points[2]).toEqual([150, 160]);
    expect(below.cover[1]).toBe(90);
    expect(tailShape(b, { x: 500, y: 150 })).toBeNull();
  });

  it("one box around a proposal's items", () => {
    expect(unionRect([{ x: 10, y: 20, w: 10, h: 10 }, { x: 50, y: 0, w: 10, h: 5 }])).toEqual({ x: 10, y: 0, w: 50, h: 30 });
    expect(unionRect([])).toBeNull();
  });
});
