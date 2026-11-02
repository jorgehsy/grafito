// Speech bubbles and bubble markers, as pure functions: what a bubble points at, which turns get a marker on the
// timeline rail, which bubbles are open, and where an open bubble and its tail go on screen.
import { findElement, findGroup, findProposal, lastSay, proposalItems } from "@grafito/board";
import type { Board } from "@grafito/board";
import type { Op } from "@grafito/contract";
import type { Bubble } from "./session";

/** What a bubble points at: the board items (render keys) whose box the tail aims at. */
export interface BubbleTarget {
  kind: "element" | "group" | "connection" | "proposal";
  keys: string[];
}

/**
 * What `say.target` names on this board: a component, group, connection or open proposal (all of what was drawn
 * under it). An unknown or erased id, a closed proposal, a zone or no target at all is null: a general bubble.
 */
export function resolveTarget(board: Board, target: string | undefined): BubbleTarget | null {
  if (!target) return null;
  if (findElement(board, target)) return { kind: "element", keys: [target] };
  if (findGroup(board, target)) return { kind: "group", keys: [target] };
  if (board.connections.some((c) => c.id === target)) return { kind: "connection", keys: [target] };
  if (findProposal(board, target)) {
    const keys = proposalItems(board, target);
    return keys.length ? { kind: "proposal", keys } : null;
  }
  return null;
}

/** One marker on the timeline rail. */
export interface BubbleMarker {
  turn: number;
  /** null: the turn said nothing (a muted marker that opens nothing). */
  bubble: Bubble | null;
  error?: string;
}

/**
 * One marker per turn, in order, built from each turn's `say` ops only (so a restored session gets the same rail).
 * A turn still in flight gets its marker once its bubble arrives or it ends.
 */
export function bubbleMarkers(turns: readonly { n: number; ops: readonly Op[]; done: boolean; error?: string }[]): BubbleMarker[] {
  return turns
    .map((t) => ({ t, bubble: lastSay(t.ops) }))
    .filter(({ t, bubble }) => t.done || bubble)
    .map(({ t, bubble }) => ({ turn: t.n, bubble, ...(t.error ? { error: t.error } : {}) }));
}

/** Which bubbles are open. Not saved: a restored session starts with past bubbles shrunk to markers. */
export interface BubbleView {
  /** The latest turn: its bubble is open unless its marker was clicked. */
  current: number;
  /** The rail was clicked: every past bubble is open. */
  showPast: boolean;
  /** Turns whose marker was clicked since: each flips its bubble from the default above. */
  toggled: readonly number[];
}

export const initialBubbleView = (): BubbleView => ({ current: 0, showPast: false, toggled: [] });

/** A new turn shrinks the bubbles reopened from their markers again; the rail's show-all stays. */
export const withCurrent = (v: BubbleView, current: number): BubbleView => (v.current === current ? v : { ...v, current, toggled: [] });

/** Clicking the rail itself: show or hide every past bubble. */
export const toggleRail = (v: BubbleView): BubbleView => ({ ...v, showPast: !v.showPast, toggled: [] });

/** Clicking a marker: reopen that bubble, or close it again. */
export const toggleMarker = (v: BubbleView, turn: number): BubbleView =>
  ({ ...v, toggled: v.toggled.includes(turn) ? v.toggled.filter((x) => x !== turn) : [...v.toggled, turn] });

export const isOpen = (v: BubbleView, turn: number): boolean => (turn === v.current || v.showPast) !== v.toggled.includes(turn);

/** The bubbles on screen: newest first, so the current one is placed before the past ones. */
export const openBubbles = (markers: readonly BubbleMarker[], v: BubbleView): (BubbleMarker & { bubble: Bubble })[] =>
  markers.filter((m): m is BubbleMarker & { bubble: Bubble } => !!m.bubble && isOpen(v, m.turn)).reverse();

export interface Rect { x: number; y: number; w: number; h: number }

/** One box around these (the items of a proposal); null for none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Space between the target and the bubble: the tail's length. */
export const TAIL_GAP = 34;
/** Space kept free at the screen edges. */
export const EDGE = 12;

/**
 * Where a bubble of this size goes: off the target's side (right, above, left, below, aligned at its middle or ends),
 * kept on screen, preferring spots that cover neither the target nor `avoid` (the ✓/✗ toolbar, the text box, other
 * bubbles), and then as little as it can of `soft` (the other components on the board). With no target it sits in the
 * top-right corner, or the next free spot down the right side.
 */
export function placeBubble(
  size: { w: number; h: number }, target: Rect | null, screen: { w: number; h: number }, avoid: readonly Rect[], soft: readonly Rect[] = [],
): { x: number; y: number } {
  const { w, h } = size;
  const fit = (x: number, y: number): Rect => ({ x: clamp(x, EDGE, screen.w - w - EDGE), y: clamp(y, EDGE, screen.h - h - EDGE), w, h });
  const cands: Rect[] = [];
  if (target) {
    const t = target;
    const g = TAIL_GAP;
    const ys = [t.y + t.h / 2 - h / 2, t.y - h / 2, t.y + t.h - h / 2];
    const xs = [t.x + t.w / 2 - w / 2, t.x + t.w - w * 0.25, t.x - w * 0.75];
    for (const y of ys) cands.push(fit(t.x + t.w + g, y)); // right
    for (const x of xs) cands.push(fit(x, t.y - h - g)); // above
    for (const y of ys) cands.push(fit(t.x - w - g, y)); // left
    for (const x of xs) cands.push(fit(x, t.y + t.h + g)); // below
  }
  for (let y = 0; y < screen.h - h; y += 20) cands.push(fit(screen.w - w, y));
  const cx = target ? target.x + target.w / 2 : screen.w;
  const cy = target ? target.y + target.h / 2 : 0;
  let best = cands[0];
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    const score =
      (target ? 40 * overlap(c, target) : 0) +
      20 * avoid.reduce((s, a) => s + overlap(c, a), 0) +
      0.5 * soft.reduce((s, a) => s + overlap(c, a), 0) +
      Math.hypot(c.x + w / 2 - cx, c.y + h / 2 - cy) +
      i; // ties go to the earlier, preferred side
    if (score < bestScore) { bestScore = score; best = c; }
  });
  return { x: best.x, y: best.y };
}

/** How far a proposal's tail reaches past the edge of its box, toward its middle. */
const REACH = 16;

/**
 * Where the tail's tip goes. A proposal: aimed at the middle of its items' box, stopping just inside that box so it
 * does not run across the items. One item: the point of its box nearest the bubble, a few pixels out so the tip
 * touches the outline without covering it.
 */
export function tailTip(kind: BubbleTarget["kind"], target: Rect, bubble: Rect): { x: number; y: number } {
  const cx = bubble.x + bubble.w / 2;
  const cy = bubble.y + bubble.h / 2;
  if (kind === "proposal") {
    const mx = target.x + target.w / 2;
    const my = target.y + target.h / 2;
    const dx = mx - cx;
    const dy = my - cy;
    // where the line from the bubble's centre to the middle enters the box (slab method), as a fraction of it
    const near = (d: number, c: number, lo: number, len: number) => (d > 0 ? (lo - c) / d : d < 0 ? (lo + len - c) / d : -Infinity);
    const enter = Math.max(0, near(dx, cx, target.x, target.w), near(dy, cy, target.y, target.h));
    const f = Math.min(1, enter + REACH / (Math.hypot(dx, dy) || 1));
    return { x: cx + dx * f, y: cy + dy * f };
  }
  const px = clamp(cx, target.x, target.x + target.w);
  const py = clamp(cy, target.y, target.y + target.h);
  const d = Math.hypot(cx - px, cy - py);
  if (!d) return { x: px, y: py };
  return { x: px + ((cx - px) / d) * 4, y: py + ((cy - py) / d) * 4 };
}

/**
 * The tail in the bubble's own coordinates: a triangle from the bubble side facing the tip, and the short line that
 * hides the bubble's border where the tail joins it. Null when the tip is inside the bubble.
 */
export function tailShape(bubble: Rect, tip: { x: number; y: number }): { points: [number, number][]; cover: [number, number, number, number] } | null {
  const { w, h } = bubble;
  const lx = tip.x - bubble.x;
  const ly = tip.y - bubble.y;
  if (lx > 0 && lx < w && ly > 0 && ly < h) return null;
  const dx = lx - w / 2;
  const dy = ly - h / 2;
  const base = (len: number, at: number) => clamp(at, Math.min(26, len / 2), Math.max(len - 26, len / 2));
  if (Math.abs(dx) * h > Math.abs(dy) * w) {
    const edge = dx > 0 ? w : 0;
    const inner = dx > 0 ? w - 2 : 2;
    const by = base(h, ly);
    return { points: [[inner, by - 11], [inner, by + 11], [lx, ly]], cover: [edge, by - 9, edge, by + 9] };
  }
  const edge = dy > 0 ? h : 0;
  const inner = dy > 0 ? h - 2 : 2;
  const bx = base(w, lx);
  return { points: [[bx - 11, inner], [bx + 11, inner], [lx, ly]], cover: [bx - 9, edge, bx + 9, edge] };
}
