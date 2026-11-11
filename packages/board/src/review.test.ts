import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { applyReviewOp, emptyReview, isReviewOp, openFindings, reviewIsEmpty, reviewOf, serializeReview } from "./review";
import type { ReviewOp } from "./review";

const f = (id: string, severity: "high" | "medium" | "low", extra: object = {}) =>
  op.add_finding({ id, pillar: "REL", severity, text: `risk ${id}`, ...extra }) as ReviewOp;
const apply = (ops: Op[]) => reviewOf(ops);

describe("review ops", () => {
  it("are told apart from board ops and the bubble", () => {
    expect(isReviewOp(op.assess_pillar({ pillar: "SEC", status: "gap", note: "n" }))).toBe(true);
    expect(isReviewOp(f("F1", "low"))).toBe(true);
    expect(isReviewOp(op.resolve_finding({ id: "F1" }))).toBe(true);
    expect(isReviewOp(op.say({ text: "hi" }))).toBe(false);
    expect(isReviewOp(op.update_summary({ text: "s" }))).toBe(false);
  });

  it("assess_pillar keeps one assessment per pillar, the latest, in framework order", () => {
    const r = apply([
      op.assess_pillar({ pillar: "COST", status: "covered", note: "Pay per use." }),
      op.assess_pillar({ pillar: "SEC", status: "gap", note: "No auth." }),
      op.assess_pillar({ pillar: "SEC", status: "partial", note: "Auth on the API only." }),
    ]);
    expect(r.pillars).toEqual([
      { pillar: "SEC", status: "partial", note: "Auth on the API only." },
      { pillar: "COST", status: "covered", note: "Pay per use." },
    ]);
  });

  it("add_finding adds an open finding; the same id replaces it in place and reopens it", () => {
    let r = apply([f("F1", "low"), f("F2", "high", { target: "db", best_practice: "REL10-BP01" }), op.resolve_finding({ id: "F1" })]);
    expect(r.findings).toEqual([
      { id: "F1", pillar: "REL", severity: "low", text: "risk F1", open: false },
      { id: "F2", pillar: "REL", severity: "high", text: "risk F2", target: "db", bestPractice: "REL10-BP01", open: true },
    ]);
    r = reviewOf([op.add_finding({ id: "F1", pillar: "SEC", severity: "medium", text: "again" })], r);
    expect(r.findings.map((x) => [x.id, x.pillar, x.open])).toEqual([["F1", "SEC", true], ["F2", "REL", true]]);
  });

  it("resolve_finding closes a finding; an unknown id is a warning and resolving twice is nothing", () => {
    const start = apply([f("F1", "high")]);
    const closed = applyReviewOp(start, op.resolve_finding({ id: "F1" }) as ReviewOp);
    expect(closed.warnings).toEqual([]);
    expect(closed.review.findings[0].open).toBe(false);
    expect(applyReviewOp(closed.review, op.resolve_finding({ id: "F1" }) as ReviewOp)).toEqual({ review: closed.review, warnings: [] });
    expect(applyReviewOp(start, op.resolve_finding({ id: "F7" }) as ReviewOp)).toEqual({ review: start, warnings: ["resolve_finding: finding 'F7' does not exist"] });
  });

  it("never changes a review in place", () => {
    const start = apply([f("F1", "high")]);
    const copy = structuredClone(start);
    applyReviewOp(start, f("F2", "low"));
    applyReviewOp(start, op.resolve_finding({ id: "F1" }) as ReviewOp);
    applyReviewOp(start, op.assess_pillar({ pillar: "OPS", status: "gap", note: "n" }) as ReviewOp);
    expect(start).toEqual(copy);
  });

  it("lists the open findings worst first, keeping the reported order within a severity", () => {
    const r = apply([f("F1", "low"), f("F2", "high"), f("F3", "medium"), f("F4", "high"), f("F5", "medium"), op.resolve_finding({ id: "F3" })]);
    expect(openFindings(r).map((x) => x.id)).toEqual(["F2", "F4", "F5", "F1"]);
  });
});

describe("serializeReview", () => {
  it("is empty text while there is no review", () => {
    expect(reviewIsEmpty(emptyReview())).toBe(true);
    expect(serializeReview(emptyReview())).toBe("");
  });
  it("lists the six pillars with their status, the open findings with their target and best practice, and the resolved ids", () => {
    const r = apply([
      op.assess_pillar({ pillar: "SEC", status: "partial", note: 'No auth on the "admin" API.' }),
      op.assess_pillar({ pillar: "REL", status: "gap", note: "One of everything." }),
      f("F1", "high", { target: "db", best_practice: "REL10-BP01" }),
      f("F2", "low"),
      f("F3", "medium"),
      op.resolve_finding({ id: "F3" }),
    ]);
    expect(reviewIsEmpty(r)).toBe(false);
    expect(serializeReview(r)).toBe([
      "PILLARS",
      "- OPS (not assessed)",
      '- SEC partial "No auth on the \\"admin\\" API."',
      '- REL gap "One of everything."',
      "- PERF (not assessed)",
      "- COST (not assessed)",
      "- SUS (not assessed)",
      "FINDINGS",
      '- F1 [REL high] @db "risk F1" (REL10-BP01)',
      '- F2 [REL low] "risk F2"',
      "RESOLVED F3",
    ].join("\n"));
  });
  it("says so when every finding is resolved", () => {
    expect(serializeReview(apply([f("F1", "high"), op.resolve_finding({ id: "F1" })]))).toContain("FINDINGS\n(none open)\nRESOLVED F1");
  });
});
