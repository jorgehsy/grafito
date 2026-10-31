// Prices in USD per million tokens. SINGLE source of truth.
// Cache write = 5 min (1.25x input). Cache read = 0.1x input.
export interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }

export const PRICING: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}
export const zeroUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
  };
}

export function costUsd(model: string, u: Usage): number {
  const p = PRICING[model] ?? PRICING["claude-haiku-5-5"];
  return (
    (u.input_tokens * p.input + u.cache_creation_input_tokens * p.cacheWrite + u.cache_read_input_tokens * p.cacheRead + u.output_tokens * p.output) /
    1_000_000
  );
}

export const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
