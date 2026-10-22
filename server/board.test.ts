import { describe, it, expect } from "vitest";
import { buildUserText, parseToolBlock, isRetryable } from "./board";

describe("parseToolBlock", () => {
  it("acepta JSON válido", () => {
    const r = parseToolBlock("create_zone", '{"id":"a","kind":"system","title":"A"}');
    expect(r).toEqual({ ok: true, name: "create_zone", input: { id: "a", kind: "system", title: "A" } });
  });
  it("JSON roto da warning y no lanza", () => {
    const r = parseToolBlock("create_zone", '{"id":"a" "kind"');
    expect(r).toMatchObject({ ok: false, invalid: true, name: "create_zone", warning: "create_zone: JSON mal formado (se omitió)" });
  });
  it("buffer vacío es {} y se valida", () => {
    const r = parseToolBlock("create_zone", "");
    expect(r.ok).toBe(false);
    expect((r as any).warning).not.toContain("mal formado");
  });
  it("herramienta desconocida es inválida", () => {
    expect(parseToolBlock("nada", "{}").ok).toBe(false);
  });
});

describe("buildUserText", () => {
  const base = { board: "ZONAS\n- a", summary: "resumen", delta: "hola" };
  it("contenido lleva fragmento y forma", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "content" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO:\nhola");
    expect(t).toContain("Forma preferida para zonas nuevas: flow.");
  });
  it("sin modo es contenido; auto no añade forma", () => {
    const t = buildUserText({ ...base, shape: "auto" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO");
    expect(t).not.toContain("Forma preferida");
  });
  it("instrucción usa la cabecera de orden y omite la forma", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "instruction" });
    expect(t).toContain("INSTRUCCIÓN DEL USUARIO (es una orden sobre el tablero, no contenido para dibujar):\nhola");
    expect(t).not.toContain("NUEVO FRAGMENTO");
    expect(t).not.toContain("Forma preferida");
  });
  it("tablero y resumen vacíos tienen valor por defecto", () => {
    expect(buildUserText({ delta: "x" })).toContain("(tablero vacío)");
    expect(buildUserText({ delta: "x" })).toContain("(vacío)");
  });
});

describe("isRetryable", () => {
  it("429 y 5xx sí; otros 4xx no", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(529)).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
  });
});
