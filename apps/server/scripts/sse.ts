// Reads the SSE stream of POST /api/board or POST /api/architect: blocks separated by a blank line, each with an
// `event:` and a JSON `data:` line, as routes/turn.ts writes them.

import type { Usage } from "@grafito/contract";

/** The fields of every event's data: `op` (a valid op, or invalid with a warning), `usage`, `error`, `done`. */
export type SseData = Partial<Usage> & {
  name?: string;
  input?: unknown;
  invalid?: boolean;
  warning?: string;
  message?: string;
  usage?: Usage;
  timings?: { first_op_ms: number | null; total_ms: number | null };
  model?: string;
};

export type SseHandler = (event: string, data: SseData) => void;

function handleBlock(block: string, handle: SseHandler) {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (data) handle(event, JSON.parse(data));
}

export async function readSse(body: ReadableStream<Uint8Array>, handle: SseHandler): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(part, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      handleBlock(buf.slice(0, i), handle);
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handleBlock(buf, handle);
}
