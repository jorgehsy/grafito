import type { Op } from "@grafito/contract";

/** Token usage of one board request, in the order the SSE payloads carry it. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** One block of the system prompt. `cache` ends the cached prefix (tools + system so far) at this block. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

/** One board request to Claude. The tools sent, and the ops accepted, follow `catalogs`. */
export interface ClaudeParams {
  model: string;
  maxTokens: number;
  effort: "low" | "medium";
  system: readonly SystemBlock[];
  userText: string;
  catalogs: readonly string[];
}

/**
 * What a board request yields, in order:
 * - `op`: a finished tool block that parsed as a valid op.
 * - `invalid`: a finished tool block that was skipped (malformed JSON or not a valid op).
 * - `usage`: usage so far; `estimated` while the real output count is not known yet.
 * - `end`: always last on success, with the final usage and the stop reason.
 */
export type ModelEvent =
  | { type: "op"; op: Op }
  | { type: "invalid"; name: string; warning: string }
  | { type: "usage"; usage: Usage; estimated: boolean }
  | { type: "end"; stopReason: string | null; usage: Usage };

/**
 * The seam between the board route and Claude.
 * `stream` retries once, and only if no op has been yielded yet, the signal is not aborted and the
 * failure is retryable (network, 429 or 5xx). Otherwise the iterable throws; the error may carry a numeric `status`.
 */
export interface ClaudeClient {
  stream(params: ClaudeParams, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
