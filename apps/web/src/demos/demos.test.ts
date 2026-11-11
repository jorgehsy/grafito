import { describe, expect, it } from "vitest";
import { parseOp } from "@grafito/contract";
import { applyOps, emptyBoard } from "@grafito/board";
import { DEMOS } from "./index";
import { Player, demoTimeline, latencyMs, sketchBounds, stateAt } from "@grafito/board";

/** Guiones cortos de una sola zona: sin mínimo de zonas ni autocorrección, duración propia. */
const SHORT = ["context", "cycle", "before-after", "prototypes", "compact", "data-model", "sketch"];

describe.each(DEMOS)("demo $id", ({ id, demo }) => {
  it("todas las ops pasan parseOp", () => {
    const errors: string[] = [];
    for (const c of demo) for (const o of c.ops) {
      const r = parseOp(o, []);
      if (!r.ok) errors.push(r.error);
    }
    expect(errors).toEqual([]);
  });
  it("se aplican sin avisos y dejan un tablero no vacío", () => {
    const r = applyOps(emptyBoard(), demo.flatMap((c) => c.ops));
    expect(r.warnings).toEqual([]);
    expect(r.board.zones.length).toBeGreaterThanOrEqual(SHORT.includes(id) ? 1 : 2);
  });
  it("dura entre 2,5 y 3,5 minutos y los fragmentos no se pisan", () => {
    const p = new Player(demo, { onSubtitle() {}, onOps() {}, onEnd() {} });
    expect(p.duration).toBeGreaterThan(SHORT.includes(id) ? 30_000 : 150_000);
    expect(p.duration).toBeLessThan(SHORT.includes(id) ? 120_000 : 215_000);
    for (let i = 1; i < demo.length; i++) expect(demo[i].at_ms).toBeGreaterThan(demo[i - 1].at_ms);
  });
  it("tiene una autocorrección (update_label, delete o move_to_zone)", () => {
    if (SHORT.includes(id)) return;
    const names = demo.flatMap((c) => c.ops.map((o) => o.name));
    expect(names.some((n) => ["update_label", "delete", "move_to_zone"].includes(n))).toBe(true);
  });
});

describe("demo list", () => {
  it("every demo has a unique id, a name and a one-line description", () => {
    expect(new Set(DEMOS.map((d) => d.id)).size).toBe(DEMOS.length);
    for (const d of DEMOS) {
      expect(d.name.trim()).not.toBe("");
      expect(d.description.trim().length).toBeGreaterThan(10);
      expect(d.description).not.toContain("\n");
      expect(["en", "es"]).toContain(d.lang);
    }
  });
  it("every demo has chapters that cover it from start to end", () => {
    for (const d of DEMOS) {
      const tl = demoTimeline(d.demo);
      expect(tl.chapters.length).toBeGreaterThanOrEqual(2);
      expect(tl.chapters[0].start).toBe(0);
      expect(tl.chapters.at(-1)!.end).toBe(tl.duration);
      for (const ch of tl.chapters) { expect(ch.end).toBeGreaterThan(ch.start); expect(ch.title.trim()).not.toBe(""); }
    }
  });
});

describe("demo sketch", () => {
  const demo = DEMOS.find((s) => s.id === "sketch")!.demo;
  const tl = demoTimeline(demo);
  const drawn = tl.chunks.map((c, i) => ({ c, i })).filter((x) => x.c.strokes.length);

  it("draws by hand in more than one chunk, and opens with a sketch on an empty board", () => {
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    expect(drawn[0].i).toBe(0);
    expect(demo.every((c) => c.title)).toBe(true);
  });
  it("its strokes are well formed, with unique ids, and each one takes long enough to be seen", () => {
    const all = drawn.flatMap((x) => x.c.strokes);
    expect(new Set(all.map((s) => s.stroke.id)).size).toBe(all.length);
    for (const s of all) {
      expect(s.stroke.pts.length).toBeGreaterThanOrEqual(4);
      expect(s.stroke.pts.length % 2).toBe(0);
      expect(s.stroke.pts.every((v) => Number.isFinite(v))).toBe(true);
      expect(s.to - s.from).toBeGreaterThan(100);
    }
  });
  it("the ink is on the board before the diagram: drawn, read, then taken when the ops land", () => {
    for (const { c } of drawn) {
      const reading = stateAt(tl, (c.speakEnd + c.opsAt) / 2);
      expect(reading.sketch.strokes).toHaveLength(c.strokes.length);
      expect(reading.sketch.reading).toHaveLength(c.strokes.length);
      expect(stateAt(tl, c.opsAt).sketch.strokes).toEqual([]);
    }
    const first = drawn[0].c;
    expect(stateAt(tl, first.opsAt - 1).delivered).toBe(0);
  });
  it("each sketch sits near the board it is drawn on (no stroke far outside the final layout)", () => {
    const box = sketchBounds(drawn.flatMap((x) => x.c.strokes.map((s) => s.stroke)))!;
    expect(box.x).toBeGreaterThan(-50);
    expect(box.y).toBeGreaterThan(-50);
    expect(box.x + box.w).toBeLessThan(1400);
    expect(box.y + box.h).toBeLessThan(450);
  });
});

describe("player", () => {
  it("entrega ops tras la latencia simulada (1,5 a 3 s)", () => {
    for (let i = 0; i < 40; i++) {
      expect(latencyMs(i)).toBeGreaterThanOrEqual(1500);
      expect(latencyMs(i)).toBeLessThanOrEqual(3000);
    }
    const got: number[] = [];
    const p = new Player([{ at_ms: 0, text: "hola mundo", ops: [] }], { onSubtitle() {}, onOps: () => got.push(p.clock), onEnd() {} });
    for (let t = 0; t < 10_000; t += 50) p.tick(50);
    expect(got).toHaveLength(1);
    expect(got[0]).toBeGreaterThanOrEqual(660 + 1500);
  });
});

describe("demo context", () => {
  it("su texto es el dictado completo y usa la escala", () => {
    const c = DEMOS.find((s) => s.id === "context")!;
    const text = c.demo.map((x) => x.text).join(" ");
    expect(text.startsWith("quiero explicar cómo funciona la ventana de contexto en Claude Code.")).toBe(true);
    expect(text.endsWith("responder mal o a alucinar.")).toBe(true);
    const names = c.demo.flatMap((x) => x.ops.map((o) => o.name));
    expect(names).toContain("add_mark");
    expect(names).toContain("set_level");
  });
});
