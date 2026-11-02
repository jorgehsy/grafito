// The architect session: one run of architect mode on a board that starts blank with the app-made system zone.
// Each typed message is one turn: POST /api/architect, drawing ops onto the board, the `say` into the speech bubble.
// A click on a proposal (✓, ✗, or choosing an alternative) applies at once and rides along with the next turn; there
// is none while a turn is in flight, since the replay could not put it between that turn's ops.
// The session is saved as a timeline of turns and clicks (session record version 3) and restored by replaying it.
import { alternativesOf, architectZoneOp, findProposal, lastSay, proposalOf, replayArchitect, serializeBoard } from "@grafito/board";
import type { Board, ReplayedTurn } from "@grafito/board";
import type { ArchitectRecord, Op, ProposalClick, TimelineEntry, Usage } from "@grafito/contract";
import { ARCHITECT_PROMPT_VERSION, costUsd, parseRecord, RECORD_VERSION, zeroUsage } from "@grafito/contract";
import { streamOps } from "../live/sse";
import type { UsageInfo } from "../live/sse";
import { AUTOSAVE_MS, SAVE_AFTER_REQUEST_MS } from "../live/session";
import { RECORD_KEYS } from "../storage";
import type { Store } from "../storage";
import { t } from "../i18n";

/** How many past turns go with each request, word for word. */
export const RECENT_TURNS = 3;

export interface Bubble {
  text: string;
  /** Id of the element or proposal the bubble is about; none = a general remark. */
  target?: string;
}

export interface ArchitectTurn {
  n: number;
  /** What the user typed. */
  text: string;
  model: string;
  promptVersion: number;
  startedAt: number;
  totalMs: number | null;
  /** Every op received, `say` included, in order. */
  ops: Op[];
  /** The turn's last `say`; null if Claude sent none. */
  bubble: Bubble | null;
  warnings: string[];
  usage: Usage;
  /** `null` when the model is included in a plan. */
  costUsd: number | null;
  error?: string;
  done: boolean;
}

/** One click on a proposal, with its time. Choosing an alternative is an accept: the other one is erased. */
export interface ArchitectClick extends ProposalClick {
  at: number;
}

export interface ArchitectSettings {
  model: string;
  /** Enabled icon catalogs. */
  catalogs: string[];
  /** BCP 47 tag of the language setting. */
  lang: string;
}

export interface ArchitectSessionDeps {
  board: { get(): Board; submit(ops: Op[]): Promise<void>; clear(): void };
  /** `apply` gets a restored record's model and language; it may ignore values it does not offer. */
  settings: { get(): ArchitectSettings; apply?(s: { model: string; lang: string }): void };
  /** Title of the system zone, in the app's language. */
  zoneTitle(): string;
  /** Where the session autosaves: its own slot, RECORD_KEYS.architect. */
  storage: Store;
  fetchImpl?: typeof fetch;
}

export interface ArchitectSessionState {
  turns: ArchitectTurn[];
  /** A turn is in flight; the next message waits for it. */
  busy: boolean;
  /** The speech bubble on screen: the latest turn's, or null while it has none yet. */
  bubble: Bubble | null;
  /** The latest turn's error; "" if none. */
  error: string;
  /** Clicks since the last turn was sent, in order: the next turn's `actions`. */
  clicks: ArchitectClick[];
  /** An architect session left in storage by an earlier visit; offered until this session sends its first turn. */
  unclosed: ArchitectRecord | null;
  savedAt: number | null;
  /** The last problem saving the session or reading the stored one; "" if none. */
  warning: string;
}

export interface ArchitectSession {
  /** Wipes the board and makes the one system zone. The stored session stays on offer. */
  start(): void;
  /** Starts over like `start` and forgets the stored session. */
  reset(): void;
  /** Sends a typed message as a turn. Returns false, sending nothing, if it is blank or a turn is in flight. */
  send(text: string): boolean;
  /**
   * Accepts or rejects an open proposal by click: applied to the board at once, with no Claude call, and queued for
   * the next turn. Returns false, doing nothing, if a turn is in flight, the proposal is not open or a click already
   * settled it.
   */
  decide(type: ProposalClick["type"], proposal: string): boolean;
  /** Cancels the turn in flight; the session stays usable. */
  stop(): void;
  /** Stops, and saves now if anything changed since the last save. For leaving architect mode. */
  close(): void;
  snapshot(): ArchitectRecord;
  /**
   * Replaces this session with the record: a blank board with the system zone, then its timeline replayed. Bubble
   * markers, `recent` and the open proposals come back from the ops; clicks after the last turn are queued again.
   */
  restore(rec: ArchitectRecord): void;
  /** Calls `fn` now and on every change; returns the unsubscribe function. */
  subscribe(fn: (s: ArchitectSessionState) => void): () => void;
}

/** The past turns the request carries: user text and the bubble text Claude answered with. */
export const recentTurns = (turns: readonly ArchitectTurn[]): { text: string; bubble: string }[] =>
  turns.filter((x) => x.done).slice(-RECENT_TURNS).map((x) => ({ text: x.text, bubble: x.bubble?.text ?? "" }));

/**
 * What a click on a board item does: nothing on ink or paper; on one of two alternatives it chooses that one at
 * once (#36: an alternative is chosen by clicking it); on any other pencil item it selects its proposal for ✓/✗.
 */
export function pickProposal(board: Board, key: string | null): { do: "none" } | { do: "select" | "choose"; proposal: string } {
  const proposal = key ? proposalOf(board, key) : undefined;
  if (!proposal) return { do: "none" };
  return { do: alternativesOf(board, proposal).length > 1 ? "choose" : "select", proposal };
}

/** The clicks as the request's `actions`: type and proposal, in order. */
export const requestClicks = (clicks: readonly ArchitectClick[]): ProposalClick[] => clicks.map(({ type, proposal }) => ({ type, proposal }));

export const RECORD_KEY = RECORD_KEYS.architect;

const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A timeline step in memory; a turn is the same object the session updates while it streams. */
type Step = { kind: "turn"; turn: ArchitectTurn } | { kind: "click"; click: ArchitectClick };

function turnFromRecord({ entry: e, ops, warnings }: ReplayedTurn): ArchitectTurn {
  return {
    n: e.n, text: e.text, model: e.model, promptVersion: e.promptVersion, startedAt: e.startedAt, totalMs: e.totalMs,
    ops, bubble: lastSay(ops), warnings,
    usage: { input_tokens: e.usage.input, output_tokens: e.usage.output, cache_read_input_tokens: e.usage.cacheRead, cache_creation_input_tokens: e.usage.cacheWrite },
    costUsd: costUsd(e.model, zeroUsage()) === null ? null : e.costUsd, ...(e.error ? { error: e.error } : {}), done: true,
  };
}

function readStored(storage: Store): { unclosed: ArchitectRecord | null; warning: string } {
  const raw = storage.get(RECORD_KEY);
  if (!raw) return { unclosed: null, warning: "" };
  let p;
  try { p = parseRecord(JSON.parse(raw)); } catch { return { unclosed: null, warning: "" }; }
  if (p.ok) return { unclosed: p.record.appMode === "architect" && p.record.timeline.some((x) => x.kind === "turn") ? p.record : null, warning: "" };
  if (p.outdated) storage.remove(RECORD_KEY);
  return { unclosed: null, warning: p.outdated ? t("record.outdated") : "" };
}

export function createArchitectSession(d: ArchitectSessionDeps): ArchitectSession {
  const fetchImpl = d.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let id = newSessionId();
  let startedAt = Date.now();
  let turns: ArchitectTurn[] = [];
  let clicks: ArchitectClick[] = [];
  let timeline: Step[] = [];
  let busy = false;
  let abort: AbortController | null = null;
  // Every board submit not yet applied: a turn serializes the board only once they are.
  let applying: Promise<void> = Promise.resolve();
  const submit = (ops: Op[]) => {
    const p = d.board.submit(ops);
    applying = Promise.all([applying, p]).then(() => undefined, () => undefined);
  };
  // Bumped by start and stop, so a turn still finishing does not touch the new state.
  let epoch = 0;
  let { unclosed, warning } = readStored(d.storage);
  let savedAt: number | null = null;
  let dirty = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(s: ArchitectSessionState) => void>();

  const state = (): ArchitectSessionState => {
    const last = turns.at(-1);
    return { turns: [...turns], busy, bubble: last?.bubble ?? null, error: last?.error ?? "", clicks: [...clicks], unclosed, savedAt, warning };
  };
  const emit = () => { const s = state(); listeners.forEach((f) => f(s)); };

  // Saves within AUTOSAVE_MS of any change, and shortly after each turn ends, as live mode does.
  const changed = (turnEnded = false) => {
    dirty = true;
    emit();
    if (!autosaveTimer) autosaveTimer = setTimeout(() => { autosaveTimer = undefined; void save(); }, AUTOSAVE_MS);
    if (turnEnded) { clearTimeout(soonTimer); soonTimer = setTimeout(() => void save(), SAVE_AFTER_REQUEST_MS); }
  };
  const clearTimers = () => { clearTimeout(autosaveTimer); clearTimeout(soonTimer); autosaveTimer = soonTimer = undefined; };

  async function save() {
    if (!dirty || !turns.length) return;
    dirty = false;
    const rec = snapshot();
    d.storage.set(RECORD_KEY, JSON.stringify(rec));
    let error: string | null;
    try {
      const res = await fetchImpl("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
      error = res.ok ? null : `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : t("net.offline");
    }
    warning = error ? t("save.failed", { error }) : "";
    if (!error) savedAt = Date.now();
    emit();
  }

  const recordUsage = (u: Usage) => ({ input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens });
  const entryOf = (s: Step): TimelineEntry => {
    if (s.kind === "click") return { kind: "click", type: s.click.type, proposal: s.click.proposal, at: s.click.at };
    const x = s.turn;
    return {
      kind: "turn", n: x.n, text: x.text, model: x.model, promptVersion: x.promptVersion, startedAt: x.startedAt, totalMs: x.totalMs,
      ops: x.ops.map((o) => ({ name: o.name, input: o.input })), warnings: [...x.warnings], usage: recordUsage(x.usage), costUsd: x.costUsd ?? 0,
      ...(x.error ? { error: x.error } : {}),
    };
  };

  function snapshot(): ArchitectRecord {
    const { model, lang } = d.settings.get();
    const done = turns.filter((x) => x.done && !x.error);
    return {
      version: RECORD_VERSION, appMode: "architect", id, startedAt, updatedAt: Date.now(), model, speechLang: lang,
      summary: d.board.get().summary,
      timeline: timeline.map(entryOf),
      totals: { requests: done.length, costUsd: done.reduce((a, x) => a + (x.costUsd ?? 0), 0), medianVoiceFirstMs: null },
    };
  }

  async function run(text: string) {
    const myEpoch = epoch;
    const { model, catalogs, lang } = d.settings.get();
    const recent = recentTurns(turns);
    const actions = requestClicks(clicks);
    clicks = [];
    const turn: ArchitectTurn = {
      n: (turns.at(-1)?.n ?? 0) + 1, text, model, promptVersion: ARCHITECT_PROMPT_VERSION, startedAt: Date.now(), totalMs: null,
      ops: [], bubble: null, warnings: [], usage: zeroUsage(), costUsd: 0, done: false,
    };
    turns = [...turns, turn];
    timeline = [...timeline, { kind: "turn", turn }];
    busy = true;
    unclosed = null;
    abort = new AbortController();
    changed();
    const mine = () => myEpoch === epoch;
    await applying; // the board sent must show the clicks and the last turn's ops
    if (!mine()) return;
    const board = d.board.get();
    const setUsage = (u: UsageInfo) => {
      turn.usage = { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens };
      turn.costUsd = costUsd(model, turn.usage);
    };
    await streamOps(
      "/api/architect",
      { text, board: serializeBoard(board, { catalog: catalogs.length > 0 }), summary: board.summary, recent, actions, model, lang, catalogs },
      "architect",
      {
        onOp(o) {
          if (!mine()) return;
          turn.ops.push(o);
          // say is not a board element: the last one of the turn is its bubble.
          if (o.name === "say") turn.bubble = { text: o.input.text, ...(o.input.target ? { target: o.input.target } : {}) };
          else submit([o]);
          changed();
        },
        onInvalid(w) { if (mine()) { turn.warnings.push(w); changed(); } },
        onUsage(u) { if (mine()) setUsage(u); },
        onDone(info) { setUsage(info.usage); turn.totalMs = info.timings.total_ms; },
        onError(m) { turn.error = m; },
      },
      abort.signal,
      fetchImpl,
    );
    if (turn.totalMs === null) turn.totalMs = Date.now() - turn.startedAt;
    turn.done = true;
    await applying;
    if (!mine()) return;
    abort = null;
    busy = false;
    changed(true);
  }

  const halt = () => { epoch++; abort?.abort(); abort = null; busy = false; };

  function start() {
    halt();
    clearTimers();
    turns = []; clicks = []; timeline = [];
    id = newSessionId(); startedAt = Date.now();
    dirty = false; savedAt = null;
    d.board.clear();
    submit([architectZoneOp(d.zoneTitle())]);
    emit();
  }

  return {
    start,
    reset() {
      unclosed = null;
      warning = "";
      d.storage.remove(RECORD_KEY);
      start();
    },
    send(text) {
      const s = text.trim();
      if (!s || busy) return false;
      void run(s);
      return true;
    },
    decide(type, proposal) {
      if (busy) return false;
      const board = d.board.get();
      // The board lags the ops still being applied, so a click already queued also counts as settling it.
      const settled = clicks.some((c) => c.proposal === proposal || (c.type === "accept" && alternativesOf(board, c.proposal).includes(proposal)));
      if (!findProposal(board, proposal) || settled) return false;
      const click: ArchitectClick = { type, proposal, at: Date.now() };
      clicks = [...clicks, click];
      timeline = [...timeline, { kind: "click", click }];
      submit([{ name: type, input: { proposal } }]);
      changed();
      return true;
    },
    stop() { halt(); emit(); },
    close() {
      halt();
      clearTimers();
      void save();
    },
    snapshot,
    restore(rec) {
      halt();
      clearTimers();
      const r = replayArchitect(rec.timeline, d.zoneTitle());
      const byTurn = new Map(r.turns.map((x) => [x.entry, turnFromRecord(x)]));
      timeline = rec.timeline.map((e): Step => (e.kind === "turn" ? { kind: "turn", turn: byTurn.get(e)! } : { kind: "click", click: { type: e.type, proposal: e.proposal, at: e.at } }));
      turns = timeline.flatMap((s) => (s.kind === "turn" ? [s.turn] : []));
      clicks = r.pending.map(({ type, proposal, at }) => ({ type, proposal, at }));
      id = rec.id; startedAt = rec.startedAt;
      unclosed = null;
      d.settings.apply?.({ model: rec.model, lang: rec.speechLang });
      d.board.clear(); // then every op is replayed at once (the queue switches to fast mode)
      submit(r.boardOps);
      changed(true);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state());
      return () => { listeners.delete(fn); };
    },
  };
}
