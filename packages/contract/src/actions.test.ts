import { describe, expect, it } from "vitest";
import { MAX_ACTIONS, parseActions } from "./actions";

describe("parseActions", () => {
  it("takes a list of accept/reject clicks in order; absent is none", () => {
    const list = [{ type: "accept", proposal: "P3" }, { type: "reject", proposal: "P4" }];
    expect(parseActions(list)).toEqual(list);
    expect(parseActions([])).toEqual([]);
    expect(parseActions(undefined)).toEqual([]);
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
      Array.from({ length: MAX_ACTIONS + 1 }, () => ({ type: "reject", proposal: "P1" })),
    ])
      expect(parseActions(bad)).toBeNull();
  });
});
