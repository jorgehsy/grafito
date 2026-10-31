import { describe, it, expect } from "vitest";
import { buildUserText } from "./user-text";

describe("buildUserText", () => {
// Spanish on purpose: prompt text, translated with the English prompt ticket.
  const base = { board: "ZONAS\n- a", summary: "resumen", delta: "hola" };
  it("content mode carries the fragment and the shape", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "content" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO:\nhola");
    expect(t).toContain("Forma preferida para zonas nuevas: flow.");
  });
  it("no mode means content; auto adds no shape", () => {
    const t = buildUserText({ ...base, shape: "auto" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO");
    expect(t).not.toContain("Forma preferida");
  });
  it("instruction mode uses the command header and omits the shape", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "instruction" });
    expect(t).toContain("INSTRUCCIÓN DEL USUARIO (es una orden sobre el tablero, no contenido para dibujar):\nhola");
    expect(t).not.toContain("NUEVO FRAGMENTO");
    expect(t).not.toContain("Forma preferida");
  });
  it("empty board and summary fall back to defaults", () => {
    expect(buildUserText({ delta: "x" })).toContain("(tablero vacío)");
    expect(buildUserText({ delta: "x" })).toContain("(vacío)");
  });
});
