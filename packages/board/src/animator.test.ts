import { describe, expect, it } from "vitest";
import { AnimationQueue, diffTrees, speedForBacklog } from "./animator";
import type { Executor, SeqTask } from "./animator";
import type { RenderItem, RenderTree } from "./tree";

const item = (key: string, kind: RenderItem["kind"], x = 0, sig = key): RenderItem => ({
  key, kind, sig, hue: 0, geom: { x, y: 0, w: 100, h: 50 }, data: {},
});
const tree = (...items: RenderItem[]): RenderTree => ({ items, map: new Map(items.map((i) => [i.key, i])) });

describe("diffTrees", () => {
  it("new ones: zone, element, connection, annotation order", () => {
    const next = tree(item("n", "callout"), item("e", "connection"), item("elem", "element"), item("z", "zone"));
    const d = diffTrees(tree(), next);
    expect(d.sequential.map((t) => (t as { key: string }).key)).toEqual(["z", "elem", "e", "n"]);
    expect(d.moves).toEqual([]);
  });
  it("deletes grouped, then updates, then draws; moves separate", () => {
    const prev = tree(item("a", "element"), item("b", "element", 0, "viejo"), item("c", "element", 0));
    const next = tree(item("b", "element", 0, "changed"), item("c", "element", 200), item("d", "element"));
    const d = diffTrees(prev, next);
    expect(d.sequential).toEqual([{ kind: "delete", keys: ["a"] }, { kind: "update", key: "b" }, { kind: "draw", key: "d" }]);
    expect(d.moves).toEqual([{ kind: "move", key: "c" }]);
  });
  it("no changes: nothing", () => {
    const t = tree(item("a", "element"));
    expect(diffTrees(t, tree(item("a", "element")))).toEqual({ sequential: [], moves: [] });
  });
});

describe("speedForBacklog", () => {
  it("1x up to 2 pending, rises to 4x at 12 and above that is instant", () => {
    expect(speedForBacklog(0)).toBe(1);
    expect(speedForBacklog(2)).toBe(1);
    expect(speedForBacklog(7)).toBeCloseTo(2.5);
    expect(speedForBacklog(12)).toBeCloseTo(4);
    expect(speedForBacklog(13)).toBe(Infinity);
    let prev = 0;
    for (let n = 0; n <= 12; n++) { expect(speedForBacklog(n)).toBeGreaterThanOrEqual(prev); prev = speedForBacklog(n); }
  });
});

describe("AnimationQueue", () => {
  function setup() {
    const events: string[] = [];
    const releases: (() => void)[] = [];
    const hold = (label: string) => new Promise<void>((res) => { events.push("start " + label); releases.push(() => { events.push("end " + label); res(); }); });
    const exec: Executor = {
      draw: (k) => hold("draw " + k),
      update: (k) => hold("update " + k),
      remove: (ks) => hold("delete " + ks.join(",")),
      move: (k) => { events.push("move " + k); },
    };
    return { events, releases, q: new AnimationQueue(exec) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("runs in sequence and moves go right away, in parallel", async () => {
    const { events, releases, q } = setup();
    q.push({ sequential: [{ kind: "draw", key: "a" }, { kind: "draw", key: "b" }], moves: [{ kind: "move", key: "m" }] });
    await flush();
    expect(events).toEqual(["move m", "start draw a"]);
    releases[0]();
    await flush();
    expect(events.slice(-2)).toEqual(["end draw a", "start draw b"]);
    q.push({ sequential: [], moves: [{ kind: "move", key: "m2" }] });
    expect(events.at(-1)).toBe("move m2"); // without waiting for the draw in progress
    releases[1]();
    await q.whenIdle();
    expect(q.pending).toBe(0);
  });

  it("speeds up with the queue and goes instant above 12", async () => {
    const exec: Executor = { draw: async () => {}, update: async () => {}, remove: async () => {}, move() {} };
    const q = new AnimationQueue(exec);
    const tasks: SeqTask[] = Array.from({ length: 16 }, (_, i) => ({ kind: "draw", key: "k" + i }));
    q.push({ sequential: tasks, moves: [] });
    await q.whenIdle();
    const speeds = q.log.map((l) => l.speed);
    expect(speeds[0]).toBe(Infinity); // 16 pending
    expect(speeds[3]).toBe(Infinity); // 13 pending
    expect(speeds[4]).toBeCloseTo(4); // 12 pending
    expect(speeds.at(-1)).toBe(1);
    expect(speeds.at(-2)).toBe(1);
    expect(speeds.slice(4)).toEqual([...speeds.slice(4)].sort((a, b) => b - a)); // slows down as it empties
  });

  it("reset cancels what is pending", async () => {
    const { events, q } = setup();
    q.push({ sequential: [{ kind: "draw", key: "a" }, { kind: "draw", key: "b" }], moves: [] });
    await flush();
    q.reset();
    expect(q.pending).toBe(0);
    await flush();
    expect(events).toEqual(["start draw a"]);
  });
});
