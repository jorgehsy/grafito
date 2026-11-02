import { DEFAULT_MODEL, fallbackModel, fmtUsd, MODELS, priceOf } from "@grafito/contract";
import type { ModelInfo } from "@grafito/contract";

/** A mode's model choice, as the options popover shows and changes it. */
export interface ModelControl {
  model: string;
  /** Model ids the server offers; null while unknown. */
  available: readonly string[] | null;
  onModel(id: string): void;
}

/** Models the tiles offer: those the server reports as available; the API ones while that is unknown. */
export const visibleModels = (available: readonly string[] | null): readonly ModelInfo[] =>
  available ? MODELS.filter((m) => available.includes(m.id)) : MODELS.filter((m) => m.provider === "anthropic-api");

/**
 * A model that is not offered falls back to the mode's default (or to the first one offered); never from a plan
 * model to its API twin (`fallbackModel`).
 */
export const usableModel = (id: string, available: readonly string[] | null, modeDefault = DEFAULT_MODEL): string => {
  const shown = visibleModels(available);
  if (shown.some((m) => m.id === id)) return id;
  const fallback = fallbackModel(id, modeDefault);
  return shown.some((m) => m.id === fallback) ? fallback : (shown[0]?.id ?? fallback);
};

/** Model ids the server offers, from `/api/health`; null if it does not answer. */
export const fetchAvailableModels = (fetchImpl: typeof fetch = fetch): Promise<string[] | null> =>
  fetchImpl("/api/health")
    .then((r) => r.json())
    .then((h) => (Array.isArray(h?.models) ? (h.models as unknown[]).filter((x): x is string => typeof x === "string") : null), () => null);

/** True when every request ran on a plan model, so there are no dollars to show. */
export const planOnly = (models: readonly string[]): boolean => models.length > 0 && models.every((m) => priceOf(m) === null);

/** A session total: real dollars, or the plan note when nothing in it was billed. */
export const totalCost = (models: readonly string[], usd: number, included: string): string => (planOnly(models) ? included : fmtUsd(usd));
