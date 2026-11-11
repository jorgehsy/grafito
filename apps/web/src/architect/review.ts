// The review panel's pure parts: the numbers it shows, what a finding points at on the board, and where its pin goes.
import { findElement, findGroup, openFindings } from "@grafito/board";
import type { Board, Finding, Review } from "@grafito/board";
import { SEVERITIES, WA_PILLARS } from "@grafito/contract";
import type { PillarStatus, Severity, WaPillar } from "@grafito/contract";
import { resolveTarget } from "./bubbles";

export interface PillarRow {
  pillar: WaPillar;
  /** null: the review has not assessed it. */
  status: PillarStatus | null;
  note: string;
  /** Open findings under this pillar. */
  findings: number;
}

export interface ReviewStats {
  /** All six pillars, in framework order. */
  pillars: PillarRow[];
  assessed: number;
  /** Open findings per severity. */
  bySeverity: Record<Severity, number>;
  open: number;
  resolved: number;
  /** The worst severity still open; null with none open. */
  worst: Severity | null;
}

export function reviewStats(r: Review): ReviewStats {
  const open = r.findings.filter((f) => f.open);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const pillars = WA_PILLARS.map((pillar): PillarRow => {
    const a = r.pillars.find((p) => p.pillar === pillar);
    return { pillar, status: a?.status ?? null, note: a?.note ?? "", findings: open.filter((f) => f.pillar === pillar).length };
  });
  return {
    pillars, assessed: r.pillars.length, bySeverity, open: open.length, resolved: r.findings.length - open.length,
    worst: SEVERITIES.find((s) => bySeverity[s] > 0) ?? null,
  };
}

/** The open findings as the panel lists them: worst first, numbered from 1, optionally one pillar only. The number stays the same with a filter on. */
export function listedFindings(r: Review, pillar: WaPillar | null = null): { n: number; finding: Finding }[] {
  return openFindings(r).map((finding, k) => ({ n: k + 1, finding })).filter((x) => !pillar || x.finding.pillar === pillar);
}

/** The render keys a finding points at; [] when it has no target or the item is gone. */
export const findingKeys = (board: Board, f: Pick<Finding, "target">): string[] => resolveTarget(board, f.target)?.keys ?? [];

/** What the panel calls a finding's target: the item's label, or null when it has none or the item is gone. */
export function targetLabel(board: Board, target: string | undefined): string | null {
  if (!target) return null;
  const element = findElement(board, target);
  if (element) return element.label;
  const group = findGroup(board, target);
  if (group) return group.label;
  const c = board.connections.find((x) => x.id === target);
  if (!c) return null;
  const end = (id: string) => findElement(board, id)?.label ?? id;
  return c.label || `${end(c.from)} → ${end(c.to)}`;
}

export const PIN = 22;

/**
 * Where a finding's pin sits: on the top-left corner of its item, the pins of one item side by side. `nth` is the
 * pin's place among the pins of the same item.
 */
export function pinSpot(item: { left: number; top: number }, nth: number): { left: number; top: number } {
  return { left: Math.round(item.left - PIN / 2 + nth * (PIN + 2)), top: Math.round(item.top - PIN / 2) };
}
