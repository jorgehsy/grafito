// Cliente SSE de /api/board: parser incremental + streamBoard.
import type { Op } from "../ops";
import type { Usage } from "./pricing";

export interface SseEvent { event: string; data: any }

/** Parser incremental: acepta trozos arbitrarios y devuelve los eventos completos. */
export function createSseParser() {
  let buf = "";
  return {
    push(chunk: string): SseEvent[] {
      buf += chunk.replace(/\r\n/g, "\n");
      const out: SseEvent[] = [];
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        const data = /^data: (.*)$/m.exec(raw)?.[1];
        if (!event || data === undefined) continue;
        try { out.push({ event, data: JSON.parse(data) }); } catch { /* evento corrupto: se ignora */ }
      }
      return out;
    },
  };
}

export interface DoneInfo {
  usage: Usage;
  timings: { first_op_ms: number | null; total_ms: number };
  ops: number;
  model: string;
}
export interface UsageInfo extends Usage { estimated?: boolean }
export interface BoardHandlers {
  onOp(op: Op): void;
  onInvalid(warning: string): void;
  onUsage?(u: UsageInfo): void;
  onDone(d: DoneInfo): void;
  onError(message: string): void;
}

export async function streamBoard(
  body: { delta: string; summary: string; board: string; model: string; shape?: string; mode?: "content" | "instruction" },
  h: BoardHandlers,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  let res: Response;
  try {
    res = await fetchImpl("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: any) {
    if (e?.name !== "AbortError") h.onError("No se pudo conectar con el servidor: " + e.message);
    return;
  }
  if (!res.ok || !res.body) return h.onError(`Error del servidor (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const { event, data } of parser.push(dec.decode(value, { stream: true }))) {
        if (event === "op") data.invalid ? h.onInvalid(data.warning) : h.onOp({ name: data.name, input: data.input } as Op);
        else if (event === "usage") h.onUsage?.(data);
        else if (event === "done") h.onDone(data);
        else if (event === "error") h.onError(data.message);
      }
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") h.onError("Se cortó la conexión: " + e.message);
  }
}
