import { describe, expect, it } from "vitest";
import { createStore, memoryStore, readFlag, writeFlag } from "./storage";

const boom = () => { throw new Error("x"); };

describe("storage wrapper", () => {
  it("reads, writes and removes", () => {
    const s = memoryStore({ a: "1" });
    expect(s.get("a")).toBe("1");
    s.set("b", "2"); s.remove("a");
    expect([s.get("a"), s.get("b")]).toEqual([null, "2"]);
  });
  it("never throws when storage throws or is missing", () => {
    for (const s of [createStore(boom), createStore(() => ({ getItem: boom, setItem: boom, removeItem: boom })), createStore(() => null)]) {
      expect(s.get("a")).toBeNull();
      expect(() => { s.set("a", "1"); s.remove("a"); }).not.toThrow();
    }
  });
  it("flags default when unset and store 1 / 0", () => {
    const s = memoryStore();
    expect(readFlag("f", true, s)).toBe(true);
    writeFlag("f", false, s);
    expect([s.get("f"), readFlag("f", true, s)]).toEqual(["0", false]);
  });
});
