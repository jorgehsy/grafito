import { DEFAULT_MODEL, fmtUsd, MODELS, priceOf } from "@grafito/contract";
import type { ModelInfo } from "@grafito/contract";

/** Models the tiles offer: those the server reports as available; the API ones while that is unknown. */
export const visibleModels = (available: readonly string[] | null): readonly ModelInfo[] =>
  available ? MODELS.filter((m) => available.includes(m.id)) : MODELS.filter((m) => m.provider === "anthropic-api");

/** A model that is not offered falls back to the default (or to the first one offered). */
export const usableModel = (id: string, available: readonly string[] | null): string => {
  const shown = visibleModels(available);
  if (shown.some((m) => m.id === id)) return id;
  return shown.some((m) => m.id === DEFAULT_MODEL) ? DEFAULT_MODEL : (shown[0]?.id ?? DEFAULT_MODEL);
};

/** True when every request ran on a plan model, so there are no dollars to show. */
export const planOnly = (models: readonly string[]): boolean => models.length > 0 && models.every((m) => priceOf(m) === null);

/** A session total: real dollars, or the plan note when nothing in it was billed. */
export const totalCost = (models: readonly string[], usd: number, included: string): string => (planOnly(models) ? included : fmtUsd(usd));
