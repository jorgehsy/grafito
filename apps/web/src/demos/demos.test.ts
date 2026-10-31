import { describe, expect, it } from "vitest";
import { parseOp } from "@grafito/contract";
import { applyOps, emptyBoard } from "@grafito/board";
import { DEMOS } from "./index";
import { Player, latencyMs } from "@grafito/board";

/** Guiones cortos de una sola zona: sin mínimo de zonas ni autocorrección, duración propia. */
const SHORT = ["context", "cycle", "before-after", "prototypes", "compact"];

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
