// Architect mode starts every board the same way: one system zone made by the app, never by Claude.
// A saved architect session is restored by replaying its timeline onto that board; the browser and the eval share it.
import { op, parseOp } from "@grafito/contract";
import type { Op, RecordClick, RecordTurn, TimelineEntry } from "@grafito/contract";
import { CATALOG_IDS } from "@grafito/icons";
import { applyOp, emptyBoard, findZone } from "./model";
import type { ApplyResult, Board } from "./model";

/** Id of the one system zone of an architect board; Claude's `add_component` names it as its zone. */
export const ARCHITECT_ZONE_ID = "system";

/** The op that makes the system zone when architect mode starts. `title` is in the app's language. */
export const architectZoneOp = (title: string): Op => op.create_zone({ id: ARCHITECT_ZONE_ID, kind: "system", title });

/**
 * `applyOp` for an architect board, which every architect path uses: the browser, the replay and so the eval. Its
 * one extra rule: the system zone is the app's, so `delete` never takes it (nothing would make it again, and
 * every later add would fail).
 */
export function applyArchitectOp(board: Board, o: Op): ApplyResult {
  if (o.name === "delete" && findZone(board, o.input.id)) {
    return { board, warnings: [`delete: '${o.input.id}' is the system zone; delete deletes components, groups and connections`] };
  }
  return applyOp(board, o);
}

/** What a turn's speech bubble says: the last `say` wins; null if the turn has none. */
export function lastSay(ops: readonly Op[]): { text: string; target?: string } | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.name === "say") return { text: o.input.text, ...(o.input.target ? { target: o.input.target } : {}) };
  }
  return null;
}

/** A click as the op it applies: the same accept/reject Claude can send. */
export const clickOp = (c: Pick<RecordClick, "type" | "proposal">): Op => op[c.type]({ proposal: c.proposal });

export interface ReplayedTurn {
  entry: RecordTurn;
  /** The recorded ops that parse, `say` included, in order. */
  ops: Op[];
  /** The recorded warnings, then one per recorded op that did not parse. */
  warnings: string[];
}

export interface ArchitectReplay {
  board: Board;
  /** What the board took, in order: the system zone, each turn's drawing ops, each click's accept/reject. */
  boardOps: Op[];
  turns: ReplayedTurn[];
  /** The clicks after the last turn: the next turn sends them as its `actions`. */
  pending: RecordClick[];
  /** What applying the ops warned about. */
  warnings: string[];
}

/**
 * Replays an architect timeline onto a blank board: the system zone first, then each turn's ops as they arrived
 * (a broken turn too, with what it got) and each click as the local accept/reject. The record does not say which
 * catalogs were on, so its ops are parsed with all of them.
 */
export function replayArchitect(timeline: readonly TimelineEntry[], zoneTitle: string): ArchitectReplay {
  let board = emptyBoard();
  const boardOps: Op[] = [];
  const turns: ReplayedTurn[] = [];
  const warnings: string[] = [];
  let pending: RecordClick[] = [];
  const apply = (o: Op) => {
    const r = applyArchitectOp(board, o);
    board = r.board;
    warnings.push(...r.warnings);
    boardOps.push(o);
  };
  apply(architectZoneOp(zoneTitle));
  for (const entry of timeline) {
    if (entry.kind === "click") {
      apply(clickOp(entry));
      pending.push(entry);
      continue;
    }
    pending = [];
    const turn: ReplayedTurn = { entry, ops: [], warnings: [...entry.warnings] };
    for (const raw of entry.ops) {
      const p = parseOp(raw, CATALOG_IDS, "architect");
      if (!p.ok) { turn.warnings.push(p.error); continue; }
      turn.ops.push(p.op);
      // say is not a board element: it is the turn's bubble.
      if (p.op.name !== "say") apply(p.op);
    }
    turns.push(turn);
  }
  return { board, boardOps, turns, pending, warnings };
}
