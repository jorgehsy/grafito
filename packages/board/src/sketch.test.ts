import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import { applyOps, emptyBoard } from "./model";
import { computeLayout } from "./layout";
import { classifyStroke, describeSketch, hitStroke, simplifyStroke, sketchBounds, strokeBounds, strokePath } from "./sketch";
import type { Stroke } from "./sketch";

const stroke = (id: string, pts: number[]): Stroke => ({ id, by: "me", color: "#3E5E8C", pts });
/** A closed rectangle drawn in one go. */
const loop = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y + h, x, y + h, x + 2, y + 3];

describe("stroke geometry", () => {
  it("bounds one stroke and a whole sketch", () => {
    expect(strokeBounds([10, 20, 40, 5])).toEqual({ x: 10, y: 5, w: 30, h: 15 });
    expect(sketchBounds([])).toBeNull();
    expect(sketchBounds([stroke("a", [0, 0, 10, 10]), stroke("b", [50, -5, 60, 30])])).toEqual({ x: 0, y: -5, w: 60, h: 35 });
  });
  it("tells a tap, a line, a loop and a scribble apart", () => {
    expect(classifyStroke([5, 5])).toBe("dot");
    expect(classifyStroke([5, 5, 6, 6])).toBe("dot");
    expect(classifyStroke([0, 0, 50, 2, 120, -1, 200, 3])).toBe("line");
    expect(classifyStroke(loop(0, 0, 160, 80))).toBe("closed");
    expect(classifyStroke([0, 0, 40, 30, 0, 30, 40, 0, 0, 60, 40, 60])).toBe("scribble");
  });
  it("simplifying keeps the ends and the corners, and drops what lies on the way", () => {
    const pts = [0, 0, 10, 0.1, 20, 0, 30, 0.2, 40, 0, 40, 10, 40, 20, 40, 30];
    expect(simplifyStroke(pts)).toEqual([0, 0, 40, 0, 40, 30]);
    expect(simplifyStroke([1.234, 5.678])).toEqual([1.2, 5.7]);
  });
  it("the eraser hits a stroke near any of its segments", () => {
    const pts = [0, 0, 100, 0];
    expect(hitStroke(pts, 50, 6, 8)).toBe(true);
    expect(hitStroke(pts, 50, 20, 8)).toBe(false);
    expect(hitStroke(pts, 108, 0, 8)).toBe(true);
    expect(hitStroke([10, 10], 14, 13, 8)).toBe(true);
  });
  it("draws a stroke as one smooth path", () => {
    expect(strokePath([])).toBe("");
    expect(strokePath([3, 4])).toMatch(/^M3 4 l/);
    expect(strokePath([0, 0, 10, 0, 10, 10])).toBe("M0 0 Q10 0 10 5 L10 10");
  });
});

describe("describeSketch", () => {
  const board = applyOps(emptyBoard(), [
    op.create_zone({ id: "app", kind: "system", title: "Orders" }),
    op.add_component({ zone: "app", id: "web", label: "Website", type: "client" }),
    op.add_component({ zone: "app", id: "api", label: "API", type: "service" }),
    op.connect({ id: "c1", from: "web", to: "api" }),
  ]).board;

  it("an empty sketch says so", () => {
    expect(describeSketch([], emptyBoard(), undefined)).toBe("(empty sketch)");
  });
  it("on an empty board, strokes are on the empty board", () => {
    const text = describeSketch([stroke("a", loop(0, 0, 160, 80))], emptyBoard(), undefined);
    expect(text).toContain("s1: closed shape 160x80");
    expect(text).toContain("on the empty board");
    expect(text).not.toContain("WHERE THINGS ARE");
  });
  it("ties a line to the elements at its ends, in the direction drawn", async () => {
    const lay = await computeLayout(board);
    const a = lay.elements.api, w = lay.elements.web;
    const line = stroke("l", [a.x + a.w / 2, a.y + a.h / 2, w.x + w.w / 2, w.y + w.h / 2]);
    const text = describeSketch([line], board, lay);
    expect(text).toMatch(/s1: line.* from \(\d+,\d+\) on api "API" to \(\d+,\d+\) on web "Website"/);
    expect(text).toContain("WHERE THINGS ARE");
    expect(text).toContain('- zone app "Orders" x:');
    expect(text).toContain('- api "API" x:');
  });
  it("a loop around an element goes around it; a scribble on it is drawn over it", async () => {
    const lay = await computeLayout(board);
    const a = lay.elements.api;
    const around = stroke("o", loop(a.x - 20, a.y - 20, a.w + 40, a.h + 40));
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const over = stroke("x", [cx - 20, cy - 10, cx + 20, cy + 10, cx - 20, cy + 10, cx + 20, cy - 10, cx + 20, cy]);
    const text = describeSketch([around, over], board, lay);
    expect(text).toContain('s1: closed shape');
    expect(text).toContain('goes around api "API"');
    expect(text).toContain('s2: scribble');
    expect(text).toContain('drawn over api "API"');
  });
  it("ink beside a zone says which side", async () => {
    const lay = await computeLayout(board);
    const z = lay.zones.app;
    const text = describeSketch([stroke("b", loop(z.x + z.w + 200, z.y, 150, 70))], board, lay);
    expect(text).toContain("outside every zone, right of zone app");
  });
});
