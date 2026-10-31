import { describe, it, expect } from "vitest";
import { centroSello, cuerpoIconoPrefijado, escalaSello, iniciosDeFases, planEntrada, selloMarkup, SELLO_MS } from "./sello";
import { AWS_SERVICES } from "@grafito/icons";

describe("planEntrada", () => {
  it("al dibujar, el sello entra después del trazo y el relleno, y antes del texto", () => {
    expect(planEntrada("dibujar", true).map((f) => f.fase)).toEqual(["trazo", "relleno", "sello", "texto"]);
    const ini = iniciosDeFases(planEntrada("dibujar", true), { trazo: 900, relleno: 240, texto: 500 });
    expect(ini.sello).toBe(900 + 240);
    expect(ini.texto).toBe(900 + 240 + SELLO_MS);
  });
  it("sin servicio no hay fase de sello", () => {
    expect(planEntrada("dibujar", false).map((f) => f.fase)).toEqual(["trazo", "relleno", "texto"]);
  });
  it("set_service sobre algo ya dibujado: solo el sello, sin trazo ni texto, y arranca de inmediato", () => {
    const plan = planEntrada("set_service", true);
    expect(plan.map((f) => f.fase)).toEqual(["sello"]);
    expect(iniciosDeFases(plan, {}).sello).toBe(0);
    expect(planEntrada("set_service", false)).toEqual([]);
  });
  it("la duración se acorta con la velocidad", () => {
    expect(planEntrada("set_service", true, 2)[0].dur).toBe(SELLO_MS / 2);
  });
});

describe("salto del sello", () => {
  it("crece a ~118 % y se asienta en 100 %", () => {
    expect(escalaSello(0)).toBe(0);
    expect(escalaSello(0.7)).toBeCloseTo(1.18);
    expect(escalaSello(1)).toBeCloseTo(1);
  });
  it("misma esquina para cajas; el rombo va sobre su lado de arriba a la izquierda", () => {
    expect(centroSello("step", 200, 80)).toEqual(centroSello("component:actor", 90, 120));
    expect(centroSello("decision", 200, 120)).toEqual({ x: 200 / 2 - 34 + 4, y: 120 / 4 - 6 + 4 });
  });
});

describe("SVG incrustado", () => {
  const ids = (s: string) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

  it("incrusta el SVG oficial, sin <image> ni <title>", () => {
    const m = selloMarkup("aws:lambda", { x: 4, y: 4 }, "sello1-")!;
    expect(m).toContain("<path");
    expect(m).not.toContain("<image");
    expect(m).not.toContain("<title");
    expect(m).toContain('data-rot="-7"');
    expect(m).toContain("scale(0.375)");
  });
  it("dos elementos del mismo servicio no repiten ids", () => {
    const todo = selloMarkup("aws:lambda", { x: 4, y: 4 }, "sello1-")! + selloMarkup("aws:lambda", { x: 4, y: 4 }, "sello2-")!;
    const l = ids(todo);
    expect(l.length).toBeGreaterThan(2);
    expect(new Set(l).size).toBe(l.length);
  });
  it("servicio desconocido: null", () => {
    expect(selloMarkup("aws:inventado", { x: 0, y: 0 }, "p-")).toBeNull();
  });
  it("prefija también las referencias a los ids", () => {
    const out = cuerpoIconoPrefijado(
      `<svg viewBox="0 0 80 80"><title>t</title><defs><clipPath id="a/b"><rect/></clipPath></defs><g clip-path="url(#a/b)"><use xlink:href="#a/b"/></g></svg>`,
      "p-",
    );
    expect(out).toContain('id="p-a/b"');
    expect(out).toContain("url(#p-a/b)");
    expect(out).toContain('xlink:href="#p-a/b"');
  });
  it("todos los servicios tienen markup y ningún id queda sin prefijo", () => {
    for (const s of AWS_SERVICES) {
      const m = selloMarkup(`aws:${s.id}`, { x: 0, y: 0 }, "z-")!;
      expect(m, s.id).toBeTruthy();
      for (const id of ids(m)) if (!id.startsWith("z-")) throw new Error(`${s.id}: ${id}`);
    }
  });
});
