import { parseOp } from "@grafito/contract";
import type { ModelEvent, Usage } from "./client";

/** The subset of the Messages API stream events that the board reads. */
export type RawEvent =
  | { type: "message_start"; message?: { usage?: Partial<Usage> } }
  | { type: "content_block_start"; index: number; content_block?: { type: string; name?: string } }
  | { type: "content_block_delta"; index: number; delta?: { type: string; partial_json?: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string | null }; usage?: { output_tokens?: number | null } }
  | { type: "message_stop" };

/** Opens one raw stream (one attempt). */
export type OpenStream = (signal: AbortSignal) => Promise<AsyncIterable<RawEvent>>;

// Retryable: network error, 5xx or 429; other 4xx are not.
function isRetryable(status: unknown): boolean {
  if (typeof status !== "number") return true;
  return !(status >= 400 && status < 500 && status !== 429);
}

/**
 * Turns raw stream events into ModelEvents: buffers each tool block's JSON, parses it when the block ends
 * (a block with broken JSON is skipped, the rest go on), estimates output as chars/4 until the real figure
 * arrives, and retries once if no op has been yielded yet.
 */
export async function* modelEvents(open: OpenStream, catalogs: readonly string[], signal: AbortSignal): AsyncGenerator<ModelEvent> {
  // Usage known so far; output is estimated as chars/4 until the real figure arrives.
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let streamedChars = 0;
  let lastEmit = 0;
  let realOutput = false;
  let stopReason: string | null = null;
  let ops = 0;

  async function* attempt(): AsyncGenerator<ModelEvent> {
    const stream = await open(signal);
    const blocks = new Map<number, { name: string; buf: string }>();
    for await (const ev of stream) {
      if (ev.type === "message_start") {
        const u = ev.message?.usage ?? {};
        usage.input_tokens = u.input_tokens ?? 0;
        usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0;
        usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
        usage.output_tokens = u.output_tokens ?? 0;
        yield { type: "usage", usage: { ...usage }, estimated: true };
      } else if (ev.type === "content_block_start") {
        if (ev.content_block?.type === "tool_use") blocks.set(ev.index, { name: ev.content_block.name ?? "", buf: "" });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta") {
        const b = blocks.get(ev.index);
        if (b) b.buf += ev.delta.partial_json ?? "";
        streamedChars += (ev.delta.partial_json ?? "").length;
        const now = Date.now();
        if (!realOutput && now - lastEmit > 250) {
          lastEmit = now;
          yield { type: "usage", usage: { ...usage, output_tokens: Math.ceil(streamedChars / 4) }, estimated: true };
        }
      } else if (ev.type === "content_block_stop") {
        const b = blocks.get(ev.index);
        if (!b) continue;
        blocks.delete(ev.index);
        const r = parseBlock(b.name, b.buf, catalogs);
        if (r.type === "op") ops++;
        yield r;
      } else if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage?.output_tokens != null) {
          realOutput = true;
          usage.output_tokens = ev.usage.output_tokens;
          yield { type: "usage", usage: { ...usage }, estimated: false };
        }
      }
    }
  }

  try {
    yield* attempt();
  } catch (e) {
    // One retry only, and only if no op has been sent yet.
    if (ops > 0 || signal.aborted || !isRetryable((e as { status?: unknown })?.status)) throw e;
    streamedChars = 0;
    realOutput = false;
    yield* attempt();
  }
  yield { type: "end", stopReason, usage: { ...usage } };
}

// Parses and validates a finished tool_use block. An empty buffer means {}.
function parseBlock(name: string, json: string, catalogs: readonly string[]): ModelEvent {
  let input: unknown;
  try {
    input = json.trim() === "" ? {} : JSON.parse(json);
  } catch {
    return { type: "invalid", name, warning: `${name}: malformed JSON (skipped)` };
  }
  const r = parseOp({ name, input }, catalogs);
  return r.ok ? { type: "op", op: r.op } : { type: "invalid", name, warning: r.error };
}
