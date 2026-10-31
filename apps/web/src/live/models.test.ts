import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "@grafito/contract";
import { planOnly, totalCost, usableModel, visibleModels } from "./models";

const API = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const PLAN = ["claude-sonnet-5-5@subscription", "claude-haiku-5-5@subscription"];
const ids = (a: string[] | null) => visibleModels(a).map((m) => m.id);

describe("visible models", () => {
  it("shows the API models while health is unknown", () => expect(ids(null)).toEqual(API));
  it("shows only the available ones", () => {
    expect(ids(PLAN)).toEqual(PLAN);
    expect(ids([...API, PLAN[0]])).toEqual([API[0], API[1], PLAN[0]]);
    expect(ids([])).toEqual([]);
  });
});

describe("usable model", () => {
  it("keeps an available choice", () => expect(usableModel(PLAN[0], PLAN)).toBe(PLAN[0]));
  it("falls back to the default when unavailable", () => {
    expect(usableModel(PLAN[0], API)).toBe(DEFAULT_MODEL);
    expect(usableModel("gone", null)).toBe(DEFAULT_MODEL);
  });
  it("falls back to the first offered when the default is not", () => expect(usableModel(API[0], PLAN)).toBe(PLAN[0]));
});

describe("cost display", () => {
  it("plan-only sessions say included", () => {
    expect(planOnly(PLAN)).toBe(true);
    expect(totalCost(PLAN, 0, "included")).toBe("included");
  });
  it("mixed and API sessions show dollars", () => {
    expect(planOnly([API[0], PLAN[0]])).toBe(false);
    expect(totalCost([API[0], PLAN[0]], 0.5, "included")).toBe("$0.5000");
    expect(totalCost(API, 0.5, "included")).toBe("$0.5000");
  });
});
