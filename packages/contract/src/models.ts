// The models Grafito can call: ids, labels and prices (USD per million tokens). SINGLE source of truth.
// Cache write = 5 min (1.25x input). Cache read = 0.1x input.
export interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }

export interface ModelInfo {
  id: string;
  label: string;
  /** What the UI says it is for: `best` answers better, `faster` answers sooner. */
  tier: "best" | "faster";
  price: Price;
}

const SONNET: ModelInfo = { id: "claude-sonnet-5-5", label: "Sonnet 5.5", tier: "best", price: { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 } };
const HAIKU: ModelInfo = { id: "claude-haiku-5-5", label: "Haiku 5.5", tier: "faster", price: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 } };

/** In the order the UI offers them. */
export const MODELS: readonly ModelInfo[] = [SONNET, HAIKU];
/** Used when a request names no known model, and to price unknown ids. */
export const DEFAULT_MODEL = HAIKU.id;
/** The model the eval runs against. */
export const EVAL_MODEL = SONNET.id;

export const isModelId = (id: unknown): id is string => MODELS.some((m) => m.id === id);
export const priceOf = (id: string): Price => (MODELS.find((m) => m.id === id) ?? HAIKU).price;
