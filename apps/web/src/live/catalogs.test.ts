import { describe, expect, it } from "vitest";
import { CATALOGS_KEY, loadCatalogs, saveCatalogs } from "./catalogs";

const mem = (init?: string) => {
  const m = new Map<string, string>(init === undefined ? [] : [[CATALOGS_KEY, init]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const boom = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

describe("catalogs (localStorage)", () => {
  it("apagado por defecto", () => expect(loadCatalogs(mem())).toEqual([]));
  it("guarda y lee", () => { const s = mem(); saveCatalogs(["aws"], s); expect(loadCatalogs(s)).toEqual(["aws"]); });
  it("ignora basura y catálogos desconocidos", () => {
    expect(loadCatalogs(mem("{no json"))).toEqual([]);
    expect(loadCatalogs(mem('{"a":1}'))).toEqual([]);
    expect(loadCatalogs(mem('["aws","azure",3]'))).toEqual(["aws"]);
  });
  it("tolera almacenamiento que lanza o ausente", () => {
    expect(loadCatalogs(boom)).toEqual([]);
    expect(() => saveCatalogs(["aws"], boom)).not.toThrow();
    expect(loadCatalogs(null)).toEqual([]);
    expect(() => saveCatalogs(["aws"], null)).not.toThrow();
  });
});
