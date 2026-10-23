import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { OP_SCHEMAS, OP_TOOLS } from "../ops";
import { applyOps, emptyBoard } from "../model";
import { SCRIPTS } from "./index";
import { Player, latencyMs } from "../player";

const ajv = new Ajv({ strict: true, allErrors: true });
const validators = Object.fromEntries(OP_TOOLS.map((t) => [t.name, ajv.compile(t.input_schema)]));

describe("herramientas", () => {
  it("tienen forma de herramienta de Anthropic", () => {
    for (const t of OP_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.input_schema.type).toBe("object");
      expect(Object.keys(OP_SCHEMAS)).toContain(t.name);
    }
    expect(OP_TOOLS).toHaveLength(21);
  });
});

/** Guiones cortos de una sola zona: sin mínimo de zonas ni autocorrección, duración propia. */
const SHORT = ["contexto", "ciclo", "antes-ahora", "prototipos", "compactar"];

describe.each(SCRIPTS)("guion $id", ({ id, script }) => {
  it("todas las ops validan contra su JSON Schema", () => {
    const errors: string[] = [];
    for (const c of script) for (const o of c.ops) {
      const v = validators[o.name];
      if (!v) errors.push(`op desconocida ${o.name}`);
      else if (!v(o.input)) errors.push(`${o.name}: ${ajv.errorsText(v.errors)}`);
    }
    expect(errors).toEqual([]);
  });
  it("se aplican sin avisos y dejan un tablero no vacío", () => {
    const r = applyOps(emptyBoard(), script.flatMap((c) => c.ops));
    expect(r.warnings).toEqual([]);
    expect(r.board.zones.length).toBeGreaterThanOrEqual(SHORT.includes(id) ? 1 : 2);
  });
  it("dura entre 2,5 y 3,5 minutos y los fragmentos no se pisan", () => {
    const p = new Player(script, { onSubtitle() {}, onOps() {}, onEnd() {} });
    expect(p.duration).toBeGreaterThan(SHORT.includes(id) ? 30_000 : 150_000);
    expect(p.duration).toBeLessThan(SHORT.includes(id) ? 120_000 : 215_000);
    for (let i = 1; i < script.length; i++) expect(script[i].at_ms).toBeGreaterThan(script[i - 1].at_ms);
  });
  it("tiene una autocorrección (update_label, delete o move_to_zone)", () => {
    if (SHORT.includes(id)) return;
    const names = script.flatMap((c) => c.ops.map((o) => o.name));
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

describe("guion contexto", () => {
  it("su texto es el dictado completo y usa la escala", () => {
    const c = SCRIPTS.find((s) => s.id === "contexto")!;
    const text = c.script.map((x) => x.text).join(" ");
    expect(text.startsWith("quiero explicar cómo funciona la ventana de contexto en Claude Code.")).toBe(true);
    expect(text.endsWith("responder mal o a alucinar.")).toBe(true);
    const names = c.script.flatMap((x) => x.ops.map((o) => o.name));
    expect(names).toContain("add_mark");
    expect(names).toContain("set_level");
  });
});
