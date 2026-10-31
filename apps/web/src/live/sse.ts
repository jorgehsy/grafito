import { t } from "../i18n";
import { parseOp } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import type { Usage } from "@grafito/contract";

export interface SseEvent { event: string; data: any }

/** Incremental parser: accepts arbitrary chunks and returns the complete events. */
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
        try { out.push({ event, data: JSON.parse(data) }); } catch { /* corrupt event: ignored */ }
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
  body: { delta: string; summary: string; board: string; model: string; shape?: string; mode?: "content" | "instruction"; catalogs?: string[]; lang?: string },
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
    if (e?.name !== "AbortError") h.onError(t("net.connect", { message: e.message }));
    return;
  }
  if (!res.ok || !res.body) return h.onError(t("net.http", { status: res.status }));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const { event, data } of parser.push(dec.decode(value, { stream: true }))) {
        if (event === "op") {
          // The server already checked it; parsing again makes the browser trust only what it can type.
          const p = data.invalid ? null : parseOp(data, body.catalogs ?? []);
          if (!p) h.onInvalid(data.warning);
          else if (p.ok) h.onOp(p.op);
          else h.onInvalid(p.error);
        }
        else if (event === "usage") h.onUsage?.(data);
        else if (event === "done") h.onDone(data);
        else if (event === "error") h.onError(data.message);
      }
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") h.onError(t("net.dropped", { message: e.message }));
  }
}
