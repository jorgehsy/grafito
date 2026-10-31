import { describe, expect, it } from "vitest";
import { CATALOGS_KEY, loadCatalogs, saveCatalogs } from "./catalogs";
import { memoryStore } from "../storage";

const mem = (init?: string) => memoryStore(init === undefined ? {} : { [CATALOGS_KEY]: init });

describe("catalogs preference", () => {
  it("off by default", () => expect(loadCatalogs(mem())).toEqual([]));
  it("saves and reads", () => { const s = mem(); saveCatalogs(["aws"], s); expect(loadCatalogs(s)).toEqual(["aws"]); });
  it("ignores garbage and unknown catalogs", () => {
    expect(loadCatalogs(mem("{no json"))).toEqual([]);
    expect(loadCatalogs(mem('{"a":1}'))).toEqual([]);
    expect(loadCatalogs(mem('["aws","azure",3]'))).toEqual(["aws"]);
  });
});
