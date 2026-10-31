import type { ClaudeClient, ClaudeParams, Usage } from "./client";
import { modelEvents } from "./stream";
import type { RawEvent } from "./stream";

/** A failed attempt, or a failure in the middle of one. `status` is the HTTP status (absent = network error). */
export interface FakeFailure {
  fail: true;
  status?: number;
  message: string;
}

/** One scripted attempt: raw events and failures in order, or "hang" until the request is aborted. */
export type FakeAttempt = readonly (RawEvent | FakeFailure)[] | "hang";

export interface FakeClaude extends ClaudeClient {
  /** Each call to `stream`. */
  calls: { params: ClaudeParams; signal: AbortSignal }[];
  /** Attempts opened so far (a retry opens a second one). */
  attempts: number;
}

/**
 * The test adapter: plays scripted raw stream events instead of calling the API. It shares the
 * buffering, parsing and retry rule with the Anthropic adapter, so tests exercise them for real.
 */
export function fakeClaude(script: readonly FakeAttempt[]): FakeClaude {
  const fake: FakeClaude = {
    calls: [],
    attempts: 0,
    stream(params, signal) {
      fake.calls.push({ params, signal });
      return modelEvents(open, params.catalogs, signal);
    },
  };
  const open = async (signal: AbortSignal): Promise<AsyncIterable<RawEvent>> => {
    const steps = script[fake.attempts++];
    if (steps === undefined) throw Object.assign(new Error("fake: no attempt scripted"), { status: 400 });
    if (steps === "hang") {
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve())));
      throw new Error("Request was aborted.");
    }
    if (steps[0] && "fail" in steps[0]) throw failure(steps[0]);
    return (async function* () {
      for (const s of steps) {
        if ("fail" in s) throw failure(s);
        yield s;
      }
    })();
  };
  return fake;
}

function failure(f: FakeFailure): Error {
  return Object.assign(new Error(f.message), f.status === undefined ? {} : { status: f.status });
}

// Script helpers.

export const fail = (status: number | undefined, message = "upstream failed"): FakeFailure => ({ fail: true, status, message });

export const start = (usage: Partial<Usage> = {}): RawEvent => ({ type: "message_start", message: { usage } });

/** A whole tool_use block; the JSON is streamed in `chunks` pieces. */
export function toolBlock(index: number, name: string, json: string, chunks = 2): RawEvent[] {
  const size = Math.ceil(json.length / chunks) || 1;
  const deltas: RawEvent[] = [];
  for (let i = 0; i < json.length; i += size)
    deltas.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + size) } });
  return [{ type: "content_block_start", index, content_block: { type: "tool_use", name } }, ...deltas, { type: "content_block_stop", index }];
}

export const stop = (stopReason: string, outputTokens?: number): RawEvent[] => [
  { type: "message_delta", delta: { stop_reason: stopReason }, usage: outputTokens === undefined ? {} : { output_tokens: outputTokens } },
  { type: "message_stop" },
];
