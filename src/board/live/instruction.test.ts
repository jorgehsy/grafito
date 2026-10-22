import { describe, it, expect } from "vitest";
import { hasWakeWord, splitInstruction } from "./instruction";

describe("splitInstruction", () => {
  it("separa contenido e instrucción", () => {
    expect(splitInstruction("El front llama al API. Grafito, separa en dos diagramas")).toEqual({
      content: "El front llama al API.", instruction: "separa en dos diagramas",
    });
  });
  it("sin contenido previo", () => {
    expect(splitInstruction("Grafito: agrupa los servicios")).toEqual({ content: "", instruction: "agrupa los servicios" });
  });
  it("variantes y mayúsculas", () => {
    for (const w of ["GRAFITO!", "gráfito,", "grafitto.", "Grafito"]) {
      expect(splitInstruction(`${w} borra la nota`).instruction).toBe("borra la nota");
    }
  });
  it("palabra de activación sola da instrucción vacía", () => {
    expect(splitInstruction("hola grafito")).toEqual({ content: "hola", instruction: "" });
    expect(splitInstruction("Grafito, ")).toEqual({ content: "", instruction: "" });
  });
  it("sin palabra de activación devuelve el texto", () => {
    expect(splitInstruction("sólo contenido")).toEqual({ content: "sólo contenido", instruction: "" });
  });
  it("respeta límites de palabra", () => {
    expect(hasWakeWord("grafitos y grafitoide")).toBe(false);
    expect(hasWakeWord("mi_grafito")).toBe(false);
    expect(hasWakeWord("oye, Grafito")).toBe(true);
  });
  it("usa la primera aparición", () => {
    expect(splitInstruction("a grafito b grafito c").instruction).toBe("b grafito c");
  });
});
