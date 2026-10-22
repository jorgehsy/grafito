import type { MindMap, Op } from "../mindmap/model";

export interface DoneInfo {
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  timings: { first_op_ms: number | null; total_ms: number };
  ops: number;
}
export interface DrawHandlers {
  onOp(name: string, input: any): void;
  onInvalid(warning: string): void;
  onDone(d: DoneInfo): void;
  onError(message: string): void;
}

/** Pide dibujar un fragmento y consume el SSE evento a evento. */
export async function streamDraw(
  body: { delta: string; summary: string; map: MindMap; model: string },
  h: DrawHandlers,
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch("/api/draw", {
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
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(raw)?.[1];
        const data = /^data: (.*)$/m.exec(raw)?.[1];
        if (!ev || !data) continue;
        const j = JSON.parse(data);
        if (ev === "op") j.invalid ? h.onInvalid(j.warning) : h.onOp(j.name, j.input);
        else if (ev === "done") h.onDone(j);
        else if (ev === "error") h.onError(j.message);
      }
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") h.onError("Se cortó la conexión: " + e.message);
  }
}

/** Traduce una llamada a herramienta en una Op del modelo. */
export function toOp(name: string, input: any): Op | null {
  switch (name) {
    case "set_root": case "add_node": case "update_node": case "move_node":
    case "delete_node": case "add_note": case "add_link": case "update_summary":
      return { type: name, ...input } as Op;
    default:
      return null;
  }
}
