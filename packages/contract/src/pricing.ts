import { priceOf } from "./models";

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

/** `null` when the model is included in a plan (no price), never 0. */
export function costUsd(model: string, u: Usage): number | null {
  const p = priceOf(model);
  if (!p) return null;
  return (
    (u.input_tokens * p.input + u.cache_creation_input_tokens * p.cacheWrite + u.cache_read_input_tokens * p.cacheRead + u.output_tokens * p.output) /
    1_000_000
  );
}

export const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
