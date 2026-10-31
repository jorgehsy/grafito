// The models Grafito can call: ids, labels and prices (USD per million tokens). SINGLE source of truth.
// Cache write = 5 min (1.25x input). Cache read = 0.1x input.
export interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }

export type Provider = "anthropic-api" | "claude-subscription";

export interface ModelInfo {
  id: string;
  /** The model name sent to the provider; differs from `id` when one model is offered through two providers. */
  apiModel: string;
  provider: Provider;
  label: string;
  /** What the UI says it is for: `best` answers better, `faster` answers sooner. */
  tier: "best" | "faster";
  /** Subscription models have no price: they are included in the plan. */
  price: Price | null;
}

const SONNET: ModelInfo = { id: "claude-sonnet-5-5", apiModel: "claude-sonnet-5-5", provider: "anthropic-api", label: "Sonnet 5.5", tier: "best", price: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } };
const HAIKU: ModelInfo = { id: "claude-haiku-5-5", apiModel: "claude-haiku-5-5", provider: "anthropic-api", label: "Haiku 5.5", tier: "faster", price: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 } };
const SONNET_PLAN: ModelInfo = { id: "claude-sonnet-5-5@subscription", apiModel: "claude-sonnet-5-5", provider: "claude-subscription", label: "Sonnet 5.5 · plan", tier: "best", price: null };
const HAIKU_PLAN: ModelInfo = { id: "claude-haiku-5-5@subscription", apiModel: "claude-haiku-5-5", provider: "claude-subscription", label: "Haiku 5.5 · plan", tier: "faster", price: null };

/** In the order the UI offers them. */
export const MODELS: readonly ModelInfo[] = [SONNET, HAIKU, SONNET_PLAN, HAIKU_PLAN];
/** Used when a request names no known model, and to price unknown ids. */
export const DEFAULT_MODEL = HAIKU.id;
/** The model the eval runs against. */
export const EVAL_MODEL = SONNET.id;

export const isModelId = (id: unknown): id is string => MODELS.some((m) => m.id === id);
/** `null` for subscription models; unknown ids are priced as HAIKU. */
export const priceOf = (id: string): Price | null => (MODELS.find((m) => m.id === id) ?? HAIKU).price;
