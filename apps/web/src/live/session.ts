// Sesión en vivo: scheduler (una petición en vuelo, junta lo acumulado) + streamBoard + controlador.
import type { Board } from "@grafito/board";
import type { Op } from "@grafito/contract";
import { createScheduler } from "./scheduler";
import type { Scheduler, TextKind } from "./scheduler";
import { splitInstruction } from "./instruction";
import { serializeBoard } from "@grafito/board";
import { streamBoard } from "./sse";
import type { UsageInfo } from "./sse";
import { addUsage, costUsd, zeroUsage } from "@grafito/contract";
import type { Usage } from "@grafito/contract";

export interface LogEntry {
  id: number;
  model: string;
  delta: string;
  /** "instruction" = orden hablada a Claude (palabra "Grafito"), no contenido. */
  mode: "content" | "instruction";
  /** Instrucción deshecha: sus operaciones ya no se reponen. */
  undone?: boolean;
  startedAt: number;
  firstOpMs: number | null;
  /** ms desde el último final de voz del lote hasta la primera figura (null si no vino de voz). */
  voiceFirstMs: number | null;
  totalMs: number | null;
  ops: number;
  /** Operaciones válidas recibidas (para el registro y la restauración). */
  opList: Op[];
  usage: Usage;
  usageEstimated: boolean;
  costUsd: number;
  warnings: string[];
  error?: string;
  done: boolean;
}
/** Última instrucción terminada, sin error y sin deshacer (la que "Deshacer" revertiría). */
export function lastUndoable(entries: LogEntry[]): LogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.mode === "instruction" && e.done && !e.undone && e.ops > 0) return e;
  }
  return null;
}

export interface Totals { requests: number; usage: Usage; costUsd: number }

export interface SessionDeps {
  getBoard(): Board;
  submit(ops: Op[]): Promise<void>;
  getModel(): string;
  /** "auto" o un ZoneKind: forma preferida para zonas nuevas. */
  getShape?(): string;
  /** Catálogos de iconos prendidos (p. ej. ["aws"]). Por defecto [] = apagado. */
  getCatalogs?(): string[];
  /** Instante (Date.now) del último final de voz del lote que se va a enviar; null si no es voz. */
  getVoiceAt?(): number | null;
  onLog(entries: LogEntry[], current: LogEntry | null, totals: Totals): void;
  onBusy?(busy: boolean): void;
  fetchImpl?: typeof fetch;
}

export interface LiveSession extends Scheduler {
  reset(): void;
  /** Carga filas y totales de un registro guardado (la numeración continúa tras la última). */
  restore(entries: LogEntry[], totals: Totals): void;
  /** Marca la última instrucción aplicada como deshecha. Devuelve false si no hay ninguna. */
  undoLastInstruction(): boolean;
}

export function createLiveSession(d: SessionDeps): LiveSession {
  let entries: LogEntry[] = [];
  let totals: Totals = { requests: 0, usage: zeroUsage(), costUsd: 0 };
  let abort: AbortController | null = null;
  let seq = 0;
  let epoch = 0;

  const emit = (cur: LogEntry | null) => d.onLog([...entries], cur, { ...totals });

  async function send(delta: string, mode: TextKind) {
    const myEpoch = epoch;
    const t0 = Date.now();
    const model = d.getModel();
    const voiceAt = d.getVoiceAt?.() ?? null;
    const e: LogEntry = {
      id: ++seq, model, delta, mode, startedAt: t0, firstOpMs: null, voiceFirstMs: null, totalMs: null, ops: 0, opList: [], usage: zeroUsage(),
      usageEstimated: false, costUsd: 0, warnings: [], done: false,
    };
    entries.push(e);
    abort = new AbortController();
    d.onBusy?.(true);
    emit(e);
    let last: Promise<void> = Promise.resolve();
    const setUsage = (u: UsageInfo) => {
      e.usage = { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens };
      e.usageEstimated = !!u.estimated;
      e.costUsd = costUsd(model, e.usage);
    };
    const catalogs = d.getCatalogs?.() ?? [];
    await streamBoard(
      { delta, summary: d.getBoard().summary, board: serializeBoard(d.getBoard(), { catalog: catalogs.length > 0 }), model, shape: d.getShape?.() ?? "auto", mode, catalogs },
      {
        onOp(o) {
          if (e.firstOpMs === null) { e.firstOpMs = Date.now() - t0; if (voiceAt !== null) e.voiceFirstMs = Date.now() - voiceAt; }
          e.ops++;
          e.opList.push(o);
          last = d.submit([o]);
          emit(e);
        },
        onInvalid(w) { e.warnings.push(w); emit(e); },
        onUsage(u) { setUsage(u); emit(e); },
        onDone(info) {
          setUsage(info.usage);
          e.usageEstimated = false;
          e.firstOpMs = info.timings.first_op_ms ?? e.firstOpMs;
          e.totalMs = info.timings.total_ms;
          if (myEpoch === epoch) {
            totals = { requests: totals.requests + 1, usage: addUsage(totals.usage, e.usage), costUsd: totals.costUsd + e.costUsd };
          }
        },
        onError(m) { e.error = m; },
      },
      abort.signal,
      d.fetchImpl,
    );
    if (e.totalMs === null) e.totalMs = Date.now() - t0;
    e.done = true;
    await last; // el siguiente fragmento verá el tablero ya actualizado
    abort = null;
    d.onBusy?.(false);
    emit(null);
  }

  const sch = createScheduler(send);
  return {
    ...sch,
    onFinalText(text, kind = "content") {
      if (kind === "instruction") return sch.onFinalText(text, kind);
      // El contenido va primero y la orden después, siempre por separado.
      const { content, instruction } = splitInstruction(text);
      if (content) sch.onFinalText(content, "content");
      if (instruction) sch.onFinalText(instruction, "instruction");
    },
    undoLastInstruction() {
      const e = lastUndoable(entries);
      if (!e) return false;
      entries = entries.map((x) => (x === e ? { ...x, undone: true } : x));
      emit(null);
      return true;
    },
    stop() { sch.stop(); abort?.abort(); },
    reset() {
      epoch++;
      sch.stop();
      abort?.abort();
      entries = [];
      totals = { requests: 0, usage: zeroUsage(), costUsd: 0 };
      seq = 0;
      emit(null);
    },
    restore(es, t) {
      epoch++;
      sch.stop();
      abort?.abort();
      entries = es.map((x) => ({ ...x }));
      totals = { ...t };
      seq = entries.reduce((m, x) => Math.max(m, x.id), 0);
      emit(null);
    },
  };
}
