// The architect session: one run of architect mode on a board that starts blank with the app-made system zone.
// Each typed message is one turn: POST /api/architect, drawing ops onto the board, the `say` into the speech bubble.
import { architectZoneOp, serializeBoard } from "@grafito/board";
import type { Board } from "@grafito/board";
import type { Op, Usage } from "@grafito/contract";
import { ARCHITECT_PROMPT_VERSION, costUsd, zeroUsage } from "@grafito/contract";
import { streamOps } from "../live/sse";
import type { UsageInfo } from "../live/sse";

/** How many past turns go with each request, word for word. */
export const RECENT_TURNS = 3;

export interface Bubble {
  text: string;
  /** Id of the element the bubble is about; none = a general remark. */
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

export interface ArchitectSettings {
  model: string;
  /** Enabled icon catalogs. */
  catalogs: string[];
  /** BCP 47 tag of the language setting. */
  lang: string;
}

export interface ArchitectSessionDeps {
  board: { get(): Board; submit(ops: Op[]): Promise<void>; clear(): void };
  settings: { get(): ArchitectSettings };
  /** Title of the system zone, in the app's language. */
  zoneTitle(): string;
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
}

export interface ArchitectSession {
  /** Wipes the board and makes the one system zone. */
  start(): void;
  /** Sends a typed message as a turn. Returns false, sending nothing, if it is blank or a turn is in flight. */
  send(text: string): boolean;
  /** Cancels the turn in flight; the session stays usable. */
  stop(): void;
  /** Calls `fn` now and on every change; returns the unsubscribe function. */
  subscribe(fn: (s: ArchitectSessionState) => void): () => void;
}

/** The past turns the request carries: user text and the bubble text Claude answered with. */
export const recentTurns = (turns: readonly ArchitectTurn[]): { text: string; bubble: string }[] =>
  turns.filter((x) => x.done).slice(-RECENT_TURNS).map((x) => ({ text: x.text, bubble: x.bubble?.text ?? "" }));

export function createArchitectSession(d: ArchitectSessionDeps): ArchitectSession {
  const fetchImpl = d.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let turns: ArchitectTurn[] = [];
  let busy = false;
  let abort: AbortController | null = null;
  // Bumped by start and stop, so a turn still finishing does not touch the new state.
  let epoch = 0;
  const listeners = new Set<(s: ArchitectSessionState) => void>();

  const state = (): ArchitectSessionState => {
    const last = turns.at(-1);
    return { turns: [...turns], busy, bubble: last?.bubble ?? null, error: last?.error ?? "" };
  };
  const emit = () => { const s = state(); listeners.forEach((f) => f(s)); };

  async function run(text: string) {
    const myEpoch = epoch;
    const { model, catalogs, lang } = d.settings.get();
    const board = d.board.get();
    const recent = recentTurns(turns);
    const turn: ArchitectTurn = {
      n: turns.length + 1, text, model, promptVersion: ARCHITECT_PROMPT_VERSION, startedAt: Date.now(), totalMs: null,
      ops: [], bubble: null, warnings: [], usage: zeroUsage(), costUsd: 0, done: false,
    };
    turns = [...turns, turn];
    busy = true;
    abort = new AbortController();
    emit();
    const mine = () => myEpoch === epoch;
    const setUsage = (u: UsageInfo) => {
      turn.usage = { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens };
      turn.costUsd = costUsd(model, turn.usage);
    };
    let last: Promise<void> = Promise.resolve();
    await streamOps(
      "/api/architect",
      { text, board: serializeBoard(board, { catalog: catalogs.length > 0 }), summary: board.summary, recent, model, lang, catalogs },
      "architect",
      {
        onOp(o) {
          if (!mine()) return;
          turn.ops.push(o);
          // say is not a board element: the last one of the turn is its bubble.
          if (o.name === "say") turn.bubble = { text: o.input.text, ...(o.input.target ? { target: o.input.target } : {}) };
          else last = d.board.submit([o]);
          emit();
        },
        onInvalid(w) { if (mine()) { turn.warnings.push(w); emit(); } },
        onUsage(u) { if (mine()) setUsage(u); },
        onDone(info) { setUsage(info.usage); turn.totalMs = info.timings.total_ms; },
        onError(m) { turn.error = m; },
      },
      abort.signal,
      fetchImpl,
    );
    if (turn.totalMs === null) turn.totalMs = Date.now() - turn.startedAt;
    turn.done = true;
    await last; // the next turn must see the board already updated
    if (!mine()) return;
    abort = null;
    busy = false;
    emit();
  }

  const halt = () => { epoch++; abort?.abort(); abort = null; busy = false; };

  return {
    start() {
      halt();
      turns = [];
      d.board.clear();
      void d.board.submit([architectZoneOp(d.zoneTitle())]);
      emit();
    },
    send(text) {
      const s = text.trim();
      if (!s || busy) return false;
      void run(s);
      return true;
    },
    stop() { halt(); emit(); },
    subscribe(fn) {
      listeners.add(fn);
      fn(state());
      return () => { listeners.delete(fn); };
    },
  };
}
