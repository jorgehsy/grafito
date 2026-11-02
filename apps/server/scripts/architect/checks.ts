// The architect eval's checks (#43): code rules over one turn's ops, no LLM judge. Every turn gets the first four;
// the rest run only when the scenario step's `expect` names them.
import { lastSay, openProposals } from "@grafito/board";
import type { Board, Proposal } from "@grafito/board";
import type { Op } from "@grafito/contract";
import { isBestPracticeId } from "@grafito/wellarchitected";
import type { Expect } from "./scenario";

/** `pass: null` is a check that could not apply (asksKeep with fewer than 3 pending): neither pass nor fail. */
export interface CheckResult {
  pass: boolean | null;
  detail?: string;
}

export const EVERY_TURN = ["oneSay", "oneQuestion", "alternatives", "bpIds"] as const;
export type CheckName = (typeof EVERY_TURN)[number] | Expect;
export type TurnChecks = Partial<Record<CheckName, CheckResult>>;

const PASS: CheckResult = { pass: true };
const failed = (detail: string): CheckResult => ({ pass: false, detail });

/** The ops that can carry `proposal`: what draws in pencil or ink. */
const DRAWING = new Set<Op["name"]>(["add_component", "add_group", "connect"]);
const proposalOfOp = (o: Op): string | undefined => (o.input as { proposal?: string }).proposal;
const drawnId = (o: Op): string => (o.input as { id?: string }).id ?? "";

const MAX_ALTERNATIVES = 2;
const BP_ID = /\b[A-Z]{3,4}\d{2}-BP\d{2}\b/g;
/** "keep" in English; mantener, conservar, quedarse con, dejar in Spanish (stems, any conjugation). */
const KEEP_WORDS = /\bkeep|\bmant[ei]n|\bconserv|\bqued|\bdej/i;

export function checkOneSay(ops: readonly Op[]): CheckResult {
  const n = ops.filter((o) => o.name === "say").length;
  return n === 1 ? PASS : failed(n ? `${n} says` : "no say");
}

/** On the bubble the user reads: the last say. */
export function checkOneQuestion(ops: readonly Op[]): CheckResult {
  const n = (lastSay(ops)?.text.match(/\?/g) ?? []).length;
  return n <= 1 ? PASS : failed(`${n} questions`);
}

/**
 * At most two proposals linked by alternative_to are open at once. Walks the turn's ops in order over the
 * proposals open before it, because the board model refuses a third alternative and would hide the attempt.
 */
export function checkAlternatives(ops: readonly Op[], before: readonly Proposal[] = []): CheckResult {
  const open = new Map(before.map((p) => [p.id, p.alternativeTo]));
  const setOf = (id: string): string[] => {
    const set = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [p, alt] of open) {
        const linked = set.has(p) ? alt : alt && set.has(alt) ? p : undefined;
        if (linked && open.has(linked) && !set.has(linked)) { set.add(linked); grew = true; }
      }
    }
    return [...open.keys()].filter((p) => set.has(p));
  };
  for (const o of ops) {
    if (o.name === "accept") { for (const p of setOf(o.input.proposal)) open.delete(p); }
    else if (o.name === "reject") open.delete(o.input.proposal);
    else if (o.name === "propose") {
      open.set(o.input.id, o.input.alternative_to);
      const set = setOf(o.input.id);
      if (set.length > MAX_ALTERNATIVES) return failed(`${set.length} alternatives: ${set.join(", ")}`);
    }
  }
  return PASS;
}

/** Best-practice ids anywhere in the turn's ops, in order: the bubble, labels, the summary. */
export const citedBpIds = (ops: readonly Op[]): string[] => ops.flatMap((o) => JSON.stringify(o.input).match(BP_ID) ?? []);

export function checkBpIds(ops: readonly Op[]): CheckResult {
  const unknown = [...new Set(citedBpIds(ops).filter((id) => !isBestPracticeId(id)))];
  return unknown.length ? failed(`not in the digest: ${unknown.join(", ")}`) : PASS;
}

/** What the user asked for is ink. Something must be drawn, or a turn that drew nothing would pass. */
export function checkInk(ops: readonly Op[]): CheckResult {
  const drawing = ops.filter((o) => DRAWING.has(o.name));
  if (!drawing.length) return failed("nothing drawn");
  const pencil = ops.filter((o) => o.name === "propose" || (DRAWING.has(o.name) && proposalOfOp(o)));
  return pencil.length ? failed(`in pencil: ${pencil.map((o) => `${o.name} ${drawnId(o)}`).join(", ")}`) : PASS;
}

/** Claude's own idea is pencil: every drawing op carries a proposal. */
export function checkPencil(ops: readonly Op[]): CheckResult {
  const drawing = ops.filter((o) => DRAWING.has(o.name));
  if (!drawing.length) return failed("nothing drawn");
  const ink = drawing.filter((o) => !proposalOfOp(o));
  return ink.length ? failed(`in ink: ${ink.map((o) => `${o.name} ${drawnId(o)}`).join(", ")}`) : PASS;
}

/** An out-of-scope ask draws nothing. update_summary is allowed: the prompt asks for it every turn and it draws nothing. */
export function checkBubbleOnly(ops: readonly Op[]): CheckResult {
  const other = [...new Set(ops.map((o) => o.name).filter((n) => n !== "say" && n !== "update_summary"))];
  return other.length ? failed(`also sent: ${other.join(", ")}`) : PASS;
}

/** Proposals waiting for an answer; two alternatives count as one, as in the prompt. */
export function pendingCount(board: Board): number {
  return new Set(openProposals(board).map((p) => (p.alternatives.length ? p.alternatives.join("|") : p.id))).size;
}

export function checkAsksKeep(ops: readonly Op[], pendingBefore: number): CheckResult {
  if (pendingBefore < 3) return { pass: null, detail: `only ${pendingBefore} pending before the turn` };
  return KEEP_WORDS.test(lastSay(ops)?.text ?? "") ? PASS : failed(`${pendingBefore} pending, no keep question`);
}

/** A pillar review turn names the best practice its gap comes from; checkBpIds says whether the id is real. */
export function checkReview(ops: readonly Op[]): CheckResult {
  return (lastSay(ops)?.text.match(BP_ID) ?? []).length ? PASS : failed("no best-practice id in the bubble");
}

/** Every check of one turn. `before` is the board the turn was sent with (clicks applied). */
export function checkTurn(ops: readonly Op[], ctx: { before: Board; expect: readonly Expect[] }): TurnChecks {
  const out: TurnChecks = {
    oneSay: checkOneSay(ops),
    oneQuestion: checkOneQuestion(ops),
    alternatives: checkAlternatives(ops, ctx.before.proposals),
    bpIds: checkBpIds(ops),
  };
  for (const e of ctx.expect) {
    if (e === "ink") out.ink = checkInk(ops);
    else if (e === "pencil") out.pencil = checkPencil(ops);
    else if (e === "bubbleOnly") out.bubbleOnly = checkBubbleOnly(ops);
    else if (e === "asksKeep") out.asksKeep = checkAsksKeep(ops, pendingCount(ctx.before));
    else out.review = checkReview(ops);
  }
  return out;
}
