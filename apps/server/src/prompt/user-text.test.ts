import { describe, it, expect } from "vitest";
import { buildUserText } from "./user-text";

describe("buildUserText", () => {
  const base = { board: "ZONES\n- a", summary: "summary", delta: "hola" };
  it("content mode carries the fragment and the shape", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "content" });
    expect(t).toContain("NEW SPOKEN FRAGMENT:\nhola");
    expect(t).toContain("Preferred shape for new zones: flow.");
  });
  it("no mode means content; auto adds no shape", () => {
    const t = buildUserText({ ...base, shape: "auto" });
    expect(t).toContain("NEW SPOKEN FRAGMENT");
    expect(t).not.toContain("Preferred shape");
  });
  it("instruction mode uses the command header and omits the shape", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "instruction" });
    expect(t).toContain("USER INSTRUCTION (a command about the board, not content to draw):\nhola");
    expect(t).not.toContain("NEW SPOKEN FRAGMENT");
    expect(t).not.toContain("Preferred shape");
  });
  it("empty board and summary fall back to defaults", () => {
    expect(buildUserText({ delta: "x" })).toContain("(empty board)");
    expect(buildUserText({ delta: "x" })).toContain("SUMMARY SO FAR:\n(empty)");
  });
  it("sketch mode carries the sketch's description, and what the user said about it if anything", () => {
    const t = buildUserText({ ...base, delta: "", mode: "sketch", sketch: "STROKES (1)\n- s1: dot", shape: "flow" });
    expect(t).toBe("CURRENT BOARD:\nZONES\n- a\n\nSUMMARY SO FAR:\nsummary\n\nUSER SKETCH (drawn by hand on the board; turn it into board elements):\nSTROKES (1)\n- s1: dot");
    expect(buildUserText({ ...base, mode: "sketch", sketch: "STROKES (1)" })).toContain("STROKES (1)\n\nWHAT THE USER SAID ABOUT IT:\nhola");
  });
});
