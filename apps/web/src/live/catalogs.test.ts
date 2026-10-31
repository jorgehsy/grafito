import { describe, expect, it } from "vitest";
import { CATALOGS_KEY, loadCatalogs, saveCatalogs } from "./catalogs";

const mem = (init?: string) => {
  const m = new Map<string, string>(init === undefined ? [] : [[CATALOGS_KEY, init]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const boom = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

describe("catalogs (localStorage)", () => {
  it("off by default", () => expect(loadCatalogs(mem())).toEqual([]));
  it("saves and reads", () => { const s = mem(); saveCatalogs(["aws"], s); expect(loadCatalogs(s)).toEqual(["aws"]); });
  it("ignores garbage and unknown catalogs", () => {
    expect(loadCatalogs(mem("{no json"))).toEqual([]);
    expect(loadCatalogs(mem('{"a":1}'))).toEqual([]);
    expect(loadCatalogs(mem('["aws","azure",3]'))).toEqual(["aws"]);
  });
  it("tolerates storage that throws or is missing", () => {
    expect(loadCatalogs(boom)).toEqual([]);
    expect(() => saveCatalogs(["aws"], boom)).not.toThrow();
    expect(loadCatalogs(null)).toEqual([]);
    expect(() => saveCatalogs(["aws"], null)).not.toThrow();
  });
});
