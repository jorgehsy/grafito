import { describe, expect, it } from "vitest";
import { MAX_CLICKS, parseClicks } from "./clicks";

describe("parseClicks", () => {
  it("takes a list of accept/reject clicks in order; absent is none", () => {
    const list = [{ type: "accept", proposal: "P3" }, { type: "reject", proposal: "P4" }];
    expect(parseClicks(list)).toEqual(list);
    expect(parseClicks([])).toEqual([]);
    expect(parseClicks(undefined)).toEqual([]);
  });

  it("rejects anything else", () => {
    for (const bad of [
      null,
      "accept P3",
      { type: "accept", proposal: "P3" },
      [{ type: "choose", proposal: "P3" }],
      [{ type: "accept" }],
      [{ type: "accept", proposal: "" }],
      [{ type: "accept", proposal: "  " }],
      [{ type: "accept", proposal: 3 }],
      [{ type: "accept", proposal: "P3", at: 1 }],
      Array.from({ length: MAX_CLICKS + 1 }, () => ({ type: "reject", proposal: "P1" })),
    ])
      expect(parseClicks(bad)).toBeNull();
  });
});
