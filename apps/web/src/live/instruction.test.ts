import { describe, it, expect } from "vitest";
import { hasWakeWord, splitInstruction } from "./instruction";

describe("splitInstruction", () => {
  it("splits content from the instruction", () => {
    expect(splitInstruction("The front end calls the API. Grafito, split into two diagrams")).toEqual({
      content: "The front end calls the API.", instruction: "split into two diagrams",
    });
  });
  it("no preceding content", () => {
    expect(splitInstruction("Grafito: group the services")).toEqual({ content: "", instruction: "group the services" });
  });
  it("spelling variants and capitals", () => {
    for (const w of ["GRAFITO!", "gráfito,", "grafitto.", "Grafito"]) {
      expect(splitInstruction(`${w} delete the note`).instruction).toBe("delete the note");
    }
  });
  it("the wake word alone gives an empty instruction", () => {
    expect(splitInstruction("hello grafito")).toEqual({ content: "hello", instruction: "" });
    expect(splitInstruction("Grafito, ")).toEqual({ content: "", instruction: "" });
  });
  it("without the wake word it returns the text", () => {
    expect(splitInstruction("content only")).toEqual({ content: "content only", instruction: "" });
  });
  it("respects word boundaries", () => {
    expect(hasWakeWord("grafitos and grafitoide")).toBe(false);
    expect(hasWakeWord("my_grafito")).toBe(false);
    expect(hasWakeWord("hey, Grafito")).toBe(true);
  });
  it("uses the first occurrence", () => {
    expect(splitInstruction("a grafito b grafito c").instruction).toBe("b grafito c");
  });
});
