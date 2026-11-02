import { describe, expect, it } from "vitest";
import { ARCHITECT_DEFAULT_MODEL, DEFAULT_MODEL, EVAL_MODEL, MODELS, fallbackModel, isModelId, priceOf } from "./models";
import { costUsd, zeroUsage } from "./pricing";

const usage = { ...zeroUsage(), input_tokens: 1000, output_tokens: 1000 };

describe("model registry", () => {
  it("every model has a provider and the model name to send", () => {
    for (const m of MODELS) {
      expect(["anthropic-api", "claude-subscription"]).toContain(m.provider);
      expect(m.apiModel).toMatch(/^claude-/);
    }
  });

  it("API models send their own id and have a price", () => {
    for (const m of MODELS.filter((x) => x.provider === "anthropic-api")) {
      expect(m.apiModel).toBe(m.id);
      expect(m.price).not.toBeNull();
    }
  });

  it("subscription models map to the API model and have no price", () => {
    const plan = MODELS.filter((m) => m.provider === "claude-subscription");
    expect(plan.map((m) => [m.id, m.label, m.apiModel])).toEqual([
      ["claude-sonnet-5-5@subscription", "Sonnet 5.5 · plan", "claude-sonnet-5-5"],
      ["claude-haiku-5-5@subscription", "Haiku 5.5 · plan", "claude-haiku-5-5"],
    ]);
    for (const m of plan) {
      expect(m.price).toBeNull();
      expect(priceOf(m.id)).toBeNull();
      expect(isModelId(m.id)).toBe(true);
    }
  });

  it("keeps the default and eval models on the API", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(EVAL_MODEL).toBe("claude-sonnet-5-5");
  });
});

describe("fallbackModel", () => {
  it("keeps the mode's fallback for API, unknown and other plan models", () => {
    expect(fallbackModel("claude-haiku-5-5", ARCHITECT_DEFAULT_MODEL)).toBe(ARCHITECT_DEFAULT_MODEL);
    expect(fallbackModel("gone", ARCHITECT_DEFAULT_MODEL)).toBe(ARCHITECT_DEFAULT_MODEL);
    expect(fallbackModel(undefined, ARCHITECT_DEFAULT_MODEL)).toBe(ARCHITECT_DEFAULT_MODEL);
    expect(fallbackModel("claude-haiku-5-5@subscription", ARCHITECT_DEFAULT_MODEL)).toBe(ARCHITECT_DEFAULT_MODEL);
  });

  it("never names the paid API twin of the requested plan model (ADR 0004)", () => {
    expect(fallbackModel("claude-sonnet-5-5@subscription", ARCHITECT_DEFAULT_MODEL)).toBe(DEFAULT_MODEL);
  });
});

describe("costUsd", () => {
  it("is null (not 0) for subscription models", () => {
    expect(costUsd("claude-sonnet-5-5@subscription", usage)).toBeNull();
    expect(costUsd("claude-haiku-5-5@subscription", usage)).toBeNull();
  });

  it("is unchanged for API models and unknown ids", () => {
    expect(costUsd("claude-haiku-5-5", usage)).toBeCloseTo(0.0006, 10);
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(0.012, 10);
    expect(costUsd("nope", usage)).toBeCloseTo(0.0006, 10);
  });
});
