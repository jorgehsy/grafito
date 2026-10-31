import { describe, expect, it } from "vitest";
import { catalogServiceIds, isCatalogId, qualifyService, serviceIdOf } from "./catalogs";

describe("catalog registry", () => {
  it("knows its catalogs", () => {
    expect(isCatalogId("aws")).toBe(true);
    expect(isCatalogId("azure")).toBe(false);
    expect(isCatalogId(3)).toBe(false);
  });
  it("lists the services of the enabled catalogs only", () => {
    expect(catalogServiceIds(["aws"])).toContain("lambda");
    expect(catalogServiceIds([])).toEqual([]);
    expect(catalogServiceIds(["azure"])).toEqual([]);
  });
  it("qualifies and unqualifies service ids", () => {
    expect(qualifyService("lambda")).toBe("aws:lambda");
    expect(qualifyService("aws:lambda")).toBe("aws:lambda");
    expect(qualifyService("nope")).toBeNull();
    expect(qualifyService("foo:lambda")).toBeNull();
    expect(serviceIdOf("aws:lambda")).toBe("lambda");
    expect(serviceIdOf("lambda")).toBe("lambda");
  });
});
