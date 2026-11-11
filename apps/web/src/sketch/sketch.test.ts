import { describe, expect, it } from "vitest";
import { createLocalSketchStore } from "./store";
import { pendingStrokes, pictureRegion } from "./useSketch";

const stroke = (id: string, by = "me") => ({ id, by, color: "#2A2A2E", pts: [0, 0, 10, 10] });

describe("local sketch store", () => {
  it("keeps strokes in order, removes by id and tells its listeners", () => {
    const store = createLocalSketchStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.add(stroke("a")); store.add(stroke("b")); store.add(stroke("c"));
    store.remove(["b", "missing"]);
    expect(store.strokes().map((s) => s.id)).toEqual(["a", "c"]);
    expect(calls).toBe(4);
    store.remove(["missing"]);
    expect(calls).toBe(4);
    off();
    store.add(stroke("d"));
    expect(calls).toBe(4);
    expect(store.drafts()).toEqual([]);
  });
});

describe("pending strokes", () => {
  it("are mine and not handed in yet", () => {
    const all = [stroke("a"), stroke("b", "ana"), stroke("c"), stroke("d")];
    expect(pendingStrokes(all, "me", new Set(["c"])).map((s) => s.id)).toEqual(["a", "d"]);
    expect(pendingStrokes(all, "ana", new Set()).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("picture region", () => {
  it("pads the ink and keeps it centred, with a minimum size for a small doodle", () => {
    const small = pictureRegion({ x: 100, y: 100, w: 20, h: 10 });
    expect(small.w).toBe(640);
    expect(small.x + small.w / 2).toBe(110);
    expect(small.y + small.h / 2).toBe(105);
    const big = pictureRegion({ x: 0, y: 0, w: 1000, h: 600 });
    expect(big).toEqual({ x: -260, y: -260, w: 1520, h: 1120 });
  });
});
