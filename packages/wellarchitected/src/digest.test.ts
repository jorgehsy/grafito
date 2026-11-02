import { describe, expect, it } from "vitest";
import {
  BEST_PRACTICE_IDS,
  GENERAL_DESIGN_PRINCIPLES,
  WELL_ARCHITECTED_PILLARS,
  WELL_ARCHITECTED_PUBLICATION_DATE,
  isBestPracticeId,
  renderWellArchitectedDigest,
} from "./index";

const questions = WELL_ARCHITECTED_PILLARS.flatMap((p) => p.questions);
const bestPractices = questions.flatMap((q) => q.bestPractices);

describe("Well-Architected data", () => {
  it("has the six pillars in framework order", () => {
    expect(WELL_ARCHITECTED_PILLARS.map((p) => p.id)).toEqual(["OPS", "SEC", "REL", "PERF", "COST", "SUS"]);
    for (const p of WELL_ARCHITECTED_PILLARS) {
      expect(p.name).not.toBe("");
      expect(p.definition).not.toBe("");
      expect(p.designPrinciples.length).toBeGreaterThanOrEqual(5);
    }
    expect(GENERAL_DESIGN_PRINCIPLES).toHaveLength(6);
    expect(WELL_ARCHITECTED_PUBLICATION_DATE).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  // The framework published November 6, 2024, as read on 2026-11-01. A refresh that changes these is a
  // framework revision: update the numbers and NOTICE.md together.
  it("has 57 questions and 307 best practices, with the per-pillar counts of the fetched revision", () => {
    const counts = Object.fromEntries(
      WELL_ARCHITECTED_PILLARS.map((p) => [p.id, [p.questions.length, p.questions.reduce((n, q) => n + q.bestPractices.length, 0)]]),
    );
    expect(counts).toEqual({ OPS: [11, 68], SEC: [11, 63], REL: [13, 65], PERF: [5, 32], COST: [11, 50], SUS: [6, 29] });
    expect(questions).toHaveLength(57);
    expect(bestPractices).toHaveLength(307);
  });

  it("numbers questions 1..n per pillar and best practices BP01..n per question", () => {
    for (const p of WELL_ARCHITECTED_PILLARS) {
      p.questions.forEach((q, i) => {
        expect(q.id).toBe(`${p.id} ${i + 1}`);
        const prefix = `${p.id}${String(i + 1).padStart(2, "0")}`;
        expect(q.bestPractices.map((bp) => bp.id)).toEqual(
          q.bestPractices.map((_, j) => `${prefix}-BP${String(j + 1).padStart(2, "0")}`),
        );
      });
    }
  });

  it("has unique IDs and non-empty titles", () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    expect(BEST_PRACTICE_IDS.size).toBe(bestPractices.length);
    for (const x of [...questions, ...bestPractices]) expect(x.title.trim()).not.toBe("");
  });

  it("recognizes real best-practice IDs only", () => {
    expect(isBestPracticeId("REL10-BP01")).toBe(true);
    expect(isBestPracticeId("SUS01-BP01")).toBe(true);
    expect(isBestPracticeId("REL10-BP99")).toBe(false);
    expect(isBestPracticeId("REL 10")).toBe(false);
    expect(isBestPracticeId("rel10-bp01")).toBe(false);
  });
});

describe("renderWellArchitectedDigest", () => {
  const text = renderWellArchitectedDigest();

  it("names every pillar, question and best practice with its ID", () => {
    for (const p of WELL_ARCHITECTED_PILLARS) {
      expect(text).toContain(`## ${p.id} ${p.name}`);
      expect(text).toContain(p.definition);
      for (const d of p.designPrinciples) expect(text).toContain(d);
    }
    for (const d of GENERAL_DESIGN_PRINCIPLES) expect(text).toContain(d);
    for (const q of questions) expect(text).toContain(`\n${q.id} ${q.title}\n`);
    for (const bp of bestPractices) expect(text).toContain(`\n- ${bp.id} ${bp.title}`);
  });

  it("states the source, the publication date and the license", () => {
    expect(text).toContain("AWS Well-Architected Framework");
    expect(text).toContain(WELL_ARCHITECTED_PUBLICATION_DATE);
    expect(text).toContain("CC BY-SA 4.0");
  });

  it("stays within the 6-8k token budget (about 4 chars per token)", () => {
    expect(text.length / 4).toBeGreaterThan(4_000);
    expect(text.length / 4).toBeLessThan(8_000);
  });

  it("is deterministic", () => {
    expect(renderWellArchitectedDigest()).toBe(text);
  });
});
