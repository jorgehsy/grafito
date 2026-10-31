import type { Board } from "@grafito/board";
import type { Op } from "@grafito/contract";
import { createScheduler } from "./scheduler";
import type { RequestMode, Scheduler } from "./scheduler";
import { splitInstruction } from "./instruction";
import { serializeBoard } from "@grafito/board";
import { streamBoard } from "./sse";
import type { UsageInfo } from "./sse";
import { addUsage, costUsd, zeroUsage } from "@grafito/contract";
import type { Usage } from "@grafito/contract";

export interface LogEntry {
  id: number;
  model: string;
  batch: string;
  mode: RequestMode;
  /** Undone instruction: its ops are no longer replayed. */
  undone?: boolean;
  startedAt: number;
  firstOpMs: number | null;
  /** ms from the last speech result of the batch to the first shape (null if it did not come from speech). */
  voiceFirstMs: number | null;
  totalMs: number | null;
  ops: number;
  /** Valid ops received, for the session record and restore. */
  opList: Op[];
  usage: Usage;
  usageEstimated: boolean;
  costUsd: number;
  warnings: string[];
  error?: string;
  done: boolean;
}
/** The last instruction that finished, without error and not undone: the one Undo would revert. */
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
  /** BCP 47 tag of the language setting, sent to the server with every request. */
  getLang?(): string;
  /** Shape preference: "auto" or a zone kind. */
  getShape?(): string;
  /** Enabled icon catalogs, e.g. ["aws"]. Default [] = off. */
  getCatalogs?(): string[];
  /** Time (Date.now) of the last speech result of the batch about to be sent; null if not speech. */
  getVoiceAt?(): number | null;
  onLog(entries: LogEntry[], current: LogEntry | null, totals: Totals): void;
  onBusy?(busy: boolean): void;
  fetchImpl?: typeof fetch;
}

export interface LiveSession extends Scheduler {
  reset(): void;
  /** Loads rows and totals from a saved record; numbering continues after the last row. */
  restore(entries: LogEntry[], totals: Totals): void;
  /** Marks the last applied instruction as undone. Returns false if there is none. */
  undoLastInstruction(): boolean;
}

export function createLiveSession(d: SessionDeps): LiveSession {
  let entries: LogEntry[] = [];
  let totals: Totals = { requests: 0, usage: zeroUsage(), costUsd: 0 };
  let abort: AbortController | null = null;
  let seq = 0;
  let epoch = 0;

  const emit = (cur: LogEntry | null) => d.onLog([...entries], cur, { ...totals });

  async function send(batch: string, mode: RequestMode) {
    const myEpoch = epoch;
    const t0 = Date.now();
    const model = d.getModel();
    const voiceAt = d.getVoiceAt?.() ?? null;
    const e: LogEntry = {
      id: ++seq, model, batch, mode, startedAt: t0, firstOpMs: null, voiceFirstMs: null, totalMs: null, ops: 0, opList: [], usage: zeroUsage(),
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
      { delta: batch, lang: d.getLang?.(), summary: d.getBoard().summary, board: serializeBoard(d.getBoard(), { catalog: catalogs.length > 0 }), model, shape: d.getShape?.() ?? "auto", mode, catalogs },
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
    await last; // the next batch must see the board already updated
    abort = null;
    d.onBusy?.(false);
    emit(null);
  }

  const sch = createScheduler(send);
  return {
    ...sch,
    onFragment(text, kind = "content") {
      if (kind === "instruction") return sch.onFragment(text, kind);
      // Content goes first and the instruction after, always separately.
      const { content, instruction } = splitInstruction(text);
      if (content) sch.onFragment(content, "content");
      if (instruction) sch.onFragment(instruction, "instruction");
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
