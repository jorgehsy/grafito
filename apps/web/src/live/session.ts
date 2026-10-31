// The live session: finished text in, requests to Claude out, ops onto the board. It also owns the
// transcript, the session record (snapshot / restore / undo replay) and autosave to storage and the server.
import type { Board } from "@grafito/board";
import { serializeBoard } from "@grafito/board";
import type { Op, RecordRequest, SessionRecord, Usage } from "@grafito/contract";
import { addUsage, CATALOG_IDS, costUsd, parseOp, parseRecord, PROMPT_VERSION, zeroUsage } from "@grafito/contract";
import { createScheduler } from "./scheduler";
import type { RequestMode } from "./scheduler";
import { splitInstruction } from "./instruction";
import { createGrouper } from "./speech/grouper";
import { streamBoard } from "./sse";
import type { UsageInfo } from "./sse";
import type { Store } from "../storage";
import { t } from "../i18n";

export interface LogEntry {
  id: number;
  model: string;
  promptVersion: number;
  batch: string;
  mode: RequestMode;
  /** Undone instruction: its ops are no longer replayed. */
  undone?: boolean;
  startedAt: number;
  firstOpMs: number | null;
  /** ms from the last speech result of the batch to the first shape. */
  voiceFirstMs: number | null;
  totalMs: number | null;
  ops: number;
  opList: Op[];
  usage: Usage;
  usageEstimated: boolean;
  costUsd: number;
  warnings: string[];
  error?: string;
  done: boolean;
}

export interface Totals { requests: number; usage: Usage; costUsd: number }

export interface Settings {
  model: string;
  /** Shape preference: "auto" or a zone kind. */
  shape: string;
  /** Enabled icon catalogs, e.g. ["aws"]. */
  catalogs: string[];
  /** BCP 47 tag of the language setting. */
  speechLang: string;
}

export interface LiveSessionDeps {
  board: { get(): Board; submit(ops: Op[]): Promise<void>; clear(): void };
  /** `apply` gets a restored record's settings; it may ignore values it does not offer. */
  settings: { get(): Settings; apply(s: Omit<Settings, "catalogs">): void };
  storage: Store;
  fetchImpl?: typeof fetch;
}

export interface LiveSessionState {
  entries: LogEntry[];
  /** The request in flight. */
  current: LogEntry | null;
  totals: Totals;
  busy: boolean;
  transcript: { text: string; at: number }[];
  canUndo: boolean;
  medianVoiceFirstMs: number | null;
  /** A session left in storage by an earlier visit; offered until this session sends its first request. */
  unclosed: SessionRecord | null;
  savedAt: number | null;
  /** The last problem saving the session or reading the stored one; "" if none. */
  warning: string;
}

export interface LiveSession {
  /** A finished speech result or typed text. `endOfTurn` sends what is grouped now (mic stopped, text typed); text may then be "". */
  onFinalText(text: string, opts?: { endOfTurn?: boolean }): void;
  /** Cancels pending and in-flight requests and timers; the session stays usable. */
  stop(): void;
  /** Starts a new session on an empty board and forgets the stored one. */
  reset(): void;
  /** Rebuilds the board without the last applied instruction. Returns false if there is none. */
  undoLastInstruction(): boolean;
  snapshot(): SessionRecord;
  /** Replaces this session with the record and replays its ops; numbering continues after its last request. */
  restore(rec: SessionRecord): void;
  /** Calls `fn` now and on every change; returns the unsubscribe function. */
  subscribe(fn: (s: LiveSessionState) => void): () => void;
}

export const RECORD_KEY = "grafito.sessionRecord";
export const AUTOSAVE_MS = 10_000;
const SAVE_AFTER_REQUEST_MS = 300;

const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** The last instruction that finished, without error and not undone: the one Undo would revert. */
function lastUndoable(entries: LogEntry[]): LogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.mode === "instruction" && e.done && !e.undone && e.ops > 0) return e;
  }
  return null;
}

const replayOps = (entries: LogEntry[]): Op[] => entries.filter((e) => !e.undone).flatMap((e) => e.opList);

/** The record does not say which catalogs were on, so its ops are parsed with all of them. */
function entryFromRequest(r: RecordRequest): LogEntry {
  const opList: Op[] = [];
  const warnings = [...r.warnings];
  for (const o of r.ops) {
    const p = parseOp(o, CATALOG_IDS);
    if (p.ok) opList.push(p.op);
    else warnings.push(p.error);
  }
  return {
    id: r.n, model: r.model, promptVersion: r.promptVersion, batch: r.batch, mode: r.mode, ...(r.undone ? { undone: true } : {}),
    startedAt: r.startedAt, firstOpMs: r.firstOpMs, voiceFirstMs: r.voiceFirstMs, totalMs: r.totalMs, ops: opList.length, opList,
    usage: { input_tokens: r.usage.input, output_tokens: r.usage.output, cache_read_input_tokens: r.usage.cacheRead, cache_creation_input_tokens: r.usage.cacheWrite },
    usageEstimated: false, costUsd: r.costUsd, warnings, error: r.error, done: true,
  };
}

function readStored(storage: Store): { unclosed: SessionRecord | null; warning: string } {
  const raw = storage.get(RECORD_KEY);
  if (!raw) return { unclosed: null, warning: "" };
  let p;
  try { p = parseRecord(JSON.parse(raw)); } catch { return { unclosed: null, warning: "" }; }
  if (p.ok) return { unclosed: p.record.requests.length ? p.record : null, warning: "" };
  if (p.outdated) storage.remove(RECORD_KEY);
  return { unclosed: null, warning: p.outdated ? t("record.outdated") : "" };
}

export function createLiveSession(d: LiveSessionDeps): LiveSession {
  const fetchImpl = d.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const zeroTotals = (): Totals => ({ requests: 0, usage: zeroUsage(), costUsd: 0 });
  let id = newSessionId();
  let startedAt = Date.now();
  let entries: LogEntry[] = [];
  let current: LogEntry | null = null;
  let totals = zeroTotals();
  let transcript: { text: string; at: number }[] = [];
  let busy = false;
  let seq = 0;
  // Bumped by reset and restore, so a request still finishing does not count toward the new totals.
  let epoch = 0;
  let abort: AbortController | null = null;
  let voiceAt: number | null = null;
  let { unclosed, warning } = readStored(d.storage);
  let savedAt: number | null = null;
  let dirty = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(s: LiveSessionState) => void>();

  const state = (): LiveSessionState => ({
    entries: [...entries], current, totals: { ...totals }, busy, transcript,
    canUndo: !busy && !!lastUndoable(entries),
    medianVoiceFirstMs: median(entries.filter((e) => e.voiceFirstMs !== null).map((e) => e.voiceFirstMs as number)),
    unclosed, savedAt, warning,
  });
  const emit = () => { const s = state(); listeners.forEach((f) => f(s)); };

  // Saves within AUTOSAVE_MS of any change, and shortly after each request ends.
  const changed = (requestEnded = false) => {
    dirty = true;
    emit();
    if (!autosaveTimer) autosaveTimer = setTimeout(() => { autosaveTimer = undefined; void save(); }, AUTOSAVE_MS);
    if (requestEnded) { clearTimeout(soonTimer); soonTimer = setTimeout(() => void save(), SAVE_AFTER_REQUEST_MS); }
  };
  const clearTimers = () => { clearTimeout(autosaveTimer); clearTimeout(soonTimer); autosaveTimer = soonTimer = undefined; };

  async function save() {
    if (!dirty || !entries.length) return;
    dirty = false;
    const rec = snapshot();
    d.storage.set(RECORD_KEY, JSON.stringify(rec));
    let error: string | null;
    try {
      const res = await fetchImpl("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
      error = res.ok ? null : `HTTP ${res.status}`;
    } catch (e: any) {
      error = e?.message ?? t("net.offline");
    }
    warning = error ? t("save.failed", { error }) : "";
    if (!error) savedAt = Date.now();
    emit();
  }

  async function send(batch: string, mode: RequestMode) {
    const myEpoch = epoch;
    const t0 = Date.now();
    const { model, shape, catalogs, speechLang } = d.settings.get();
    const voice = voiceAt;
    voiceAt = null;
    const e: LogEntry = {
      id: ++seq, model, promptVersion: PROMPT_VERSION, batch, mode, startedAt: t0, firstOpMs: null, voiceFirstMs: null, totalMs: null,
      ops: 0, opList: [], usage: zeroUsage(), usageEstimated: false, costUsd: 0, warnings: [], done: false,
    };
    entries.push(e);
    current = e;
    unclosed = null;
    abort = new AbortController();
    busy = true;
    changed();
    let last: Promise<void> = Promise.resolve();
    const setUsage = (u: UsageInfo) => {
      e.usage = { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens };
      e.usageEstimated = !!u.estimated;
      e.costUsd = costUsd(model, e.usage);
    };
    const board = d.board.get();
    await streamBoard(
      { delta: batch, lang: speechLang, summary: board.summary, board: serializeBoard(board, { catalog: catalogs.length > 0 }), model, shape, mode, catalogs },
      {
        onOp(o) {
          if (myEpoch !== epoch) return;
          if (e.firstOpMs === null) { e.firstOpMs = Date.now() - t0; if (voice !== null) e.voiceFirstMs = Date.now() - voice; }
          e.ops++;
          e.opList.push(o);
          last = d.board.submit([o]);
          changed();
        },
        onInvalid(w) { if (myEpoch === epoch) { e.warnings.push(w); changed(); } },
        onUsage(u) { if (myEpoch === epoch) { setUsage(u); changed(); } },
        onDone(info) {
          setUsage(info.usage);
          e.usageEstimated = false;
          e.firstOpMs = info.timings.first_op_ms ?? e.firstOpMs;
          e.totalMs = info.timings.total_ms;
          if (myEpoch === epoch) totals = { requests: totals.requests + 1, usage: addUsage(totals.usage, e.usage), costUsd: totals.costUsd + e.costUsd };
        },
        onError(m) { e.error = m; },
      },
      abort.signal,
      fetchImpl,
    );
    if (e.totalMs === null) e.totalMs = Date.now() - t0;
    e.done = true;
    await last; // the next batch must see the board already updated
    if (myEpoch !== epoch) return;
    abort = null;
    current = null;
    busy = false;
    changed(true);
  }

  const scheduler = createScheduler(send);
  const toScheduler = (text: string, at: number) => {
    voiceAt = at;
    // Content goes first and the instruction after, always separately.
    const { content, instruction } = splitInstruction(text);
    if (content) scheduler.onFragment(content, "content");
    if (instruction) scheduler.onFragment(instruction, "instruction");
  };
  const grouper = createGrouper(toScheduler);

  const halt = () => { epoch++; grouper.cancel(); scheduler.stop(); abort?.abort(); abort = null; current = null; busy = false; };

  function snapshot(): SessionRecord {
    const s = d.settings.get();
    return {
      version: 2, id, startedAt, updatedAt: Date.now(), model: s.model, shape: s.shape, speechLang: s.speechLang,
      requests: entries.map((e) => ({
        n: e.id, model: e.model, promptVersion: e.promptVersion, batch: e.batch, mode: e.mode, ...(e.undone ? { undone: true } : {}),
        startedAt: e.startedAt, firstOpMs: e.firstOpMs, voiceFirstMs: e.voiceFirstMs, totalMs: e.totalMs,
        ops: e.opList.map((o) => ({ name: o.name, input: o.input })),
        warnings: [...e.warnings],
        usage: { input: e.usage.input_tokens, cacheRead: e.usage.cache_read_input_tokens, cacheWrite: e.usage.cache_creation_input_tokens, output: e.usage.output_tokens },
        costUsd: e.costUsd,
        ...(e.error ? { error: e.error } : {}),
      })),
      transcript: transcript.map((x) => ({ ...x })),
      summary: d.board.get().summary,
      totals: { requests: totals.requests, costUsd: totals.costUsd, medianVoiceFirstMs: state().medianVoiceFirstMs },
    };
  }

  return {
    onFinalText(text, opts) {
      const s = text.trim();
      if (s) {
        transcript = [...transcript, { text: s, at: Date.now() }];
        grouper.push(s);
      }
      if (opts?.endOfTurn) grouper.flush();
      if (s) changed();
    },
    stop() { halt(); clearTimers(); emit(); },
    reset() {
      halt();
      clearTimers();
      entries = []; totals = zeroTotals(); transcript = []; seq = 0;
      id = newSessionId(); startedAt = Date.now();
      dirty = false; unclosed = null; warning = ""; savedAt = null;
      d.storage.remove(RECORD_KEY);
      d.board.clear();
      emit();
    },
    undoLastInstruction() {
      const e = lastUndoable(entries);
      if (!e || busy) return false;
      entries = entries.map((x) => (x === e ? { ...x, undone: true } : x));
      d.board.clear();
      void d.board.submit(replayOps(entries));
      changed(true);
      return true;
    },
    snapshot,
    restore(rec) {
      halt();
      d.board.clear(); // then every op is replayed at once (the queue switches to fast mode)
      entries = rec.requests.map(entryFromRequest);
      const usage = entries.reduce((a, e) => addUsage(a, e.usage), zeroUsage());
      totals = { requests: rec.totals.requests, usage, costUsd: rec.totals.costUsd };
      seq = entries.reduce((m, x) => Math.max(m, x.id), 0);
      id = rec.id; startedAt = rec.startedAt;
      transcript = rec.transcript.map((x) => ({ ...x }));
      unclosed = null;
      d.settings.apply({ model: rec.model, shape: rec.shape, speechLang: rec.speechLang });
      void d.board.submit(replayOps(entries));
      changed(true);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state());
      return () => { listeners.delete(fn); };
    },
  };
}
