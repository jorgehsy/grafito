// The architect's Well-Architected review: how the design stands on each pillar, and the findings (risks) tied to
// items on the board. It is not part of the board: the review ops draw nothing, and the review is rebuilt from the
// ops of an architect session, in order, the way speech bubbles are.
import { SEVERITIES, WA_PILLARS } from "@grafito/contract";
import type { Op, PillarStatus, Severity, WaPillar } from "@grafito/contract";

export interface PillarAssessment {
  pillar: WaPillar;
  status: PillarStatus;
  /** Why, in one sentence. */
  note: string;
}

export interface Finding {
  id: string;
  pillar: WaPillar;
  severity: Severity;
  text: string;
  /** Id of the board item it is about; none = the whole design. The item may be gone by now. */
  target?: string;
  /** Id of the Well-Architected best practice it comes from, e.g. `REL10-BP01`. */
  bestPractice?: string;
  /** False once `resolve_finding` closed it. */
  open: boolean;
}

export interface Review {
  /** At most one per pillar, in framework order. */
  pillars: PillarAssessment[];
  /** In the order they were first reported; a resolved one stays, closed. */
  findings: Finding[];
}

export type ReviewOp = Extract<Op, { name: "assess_pillar" | "add_finding" | "resolve_finding" }>;

export const emptyReview = (): Review => ({ pillars: [], findings: [] });

export const isReviewOp = (o: Op): o is ReviewOp => o.name === "assess_pillar" || o.name === "add_finding" || o.name === "resolve_finding";

/** Nothing reported yet: no pillar assessed and no finding, open or closed. */
export const reviewIsEmpty = (r: Review): boolean => !r.pillars.length && !r.findings.length;

/** Applies one review op. The review is never changed in place. */
export function applyReviewOp(review: Review, o: ReviewOp): { review: Review; warnings: string[] } {
  if (o.name === "assess_pillar") {
    const { pillar, status, note } = o.input;
    const pillars = [...review.pillars.filter((p) => p.pillar !== pillar), { pillar, status, note }];
    pillars.sort((a, b) => WA_PILLARS.indexOf(a.pillar) - WA_PILLARS.indexOf(b.pillar));
    return { review: { ...review, pillars }, warnings: [] };
  }
  if (o.name === "add_finding") {
    const i = o.input;
    const finding: Finding = {
      id: i.id, pillar: i.pillar, severity: i.severity, text: i.text, open: true,
      ...(i.target ? { target: i.target } : {}), ...(i.best_practice ? { bestPractice: i.best_practice } : {}),
    };
    // an id already listed is replaced where it stands (and reopened)
    const known = review.findings.some((f) => f.id === i.id);
    return { review: { ...review, findings: known ? review.findings.map((f) => (f.id === i.id ? finding : f)) : [...review.findings, finding] }, warnings: [] };
  }
  const at = review.findings.find((f) => f.id === o.input.id);
  if (!at) return { review, warnings: [`resolve_finding: finding '${o.input.id}' does not exist`] };
  if (!at.open) return { review, warnings: [] };
  return { review: { ...review, findings: review.findings.map((f) => (f === at ? { ...f, open: false } : f)) }, warnings: [] };
}

/** The review after these ops, in order; ops that are not review ops are skipped. */
export function reviewOf(ops: readonly Op[], from: Review = emptyReview()): Review {
  let review = from;
  for (const o of ops) if (isReviewOp(o)) review = applyReviewOp(review, o).review;
  return review;
}

/** The open findings, worst first; findings of the same severity keep the order they were reported in. */
export function openFindings(r: Review): Finding[] {
  return r.findings.filter((f) => f.open).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

/** The review as prompt text (REVIEW SO FAR): every pillar with its status, then the open findings. "" when there is none. */
export function serializeReview(r: Review): string {
  if (reviewIsEmpty(r)) return "";
  const q = (s: string) => JSON.stringify(s);
  const out = ["PILLARS"];
  for (const id of WA_PILLARS) {
    const p = r.pillars.find((x) => x.pillar === id);
    out.push(p ? `- ${id} ${p.status} ${q(p.note)}` : `- ${id} (not assessed)`);
  }
  const open = r.findings.filter((f) => f.open);
  out.push("FINDINGS");
  if (!open.length) out.push("(none open)");
  for (const f of open) out.push(`- ${f.id} [${f.pillar} ${f.severity}]${f.target ? ` @${f.target}` : ""} ${q(f.text)}${f.bestPractice ? ` (${f.bestPractice})` : ""}`);
  const closed = r.findings.filter((f) => !f.open).map((f) => f.id);
  if (closed.length) out.push(`RESOLVED ${closed.join(", ")}`);
  return out.join("\n");
}
