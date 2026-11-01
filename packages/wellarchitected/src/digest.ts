import { FRAMEWORK } from "./framework.generated";
import { PILLARS } from "./pillars";
import type { Pillar } from "./types";

/** As printed on the framework's welcome page when the data was fetched, e.g. `November 6, 2024`. */
export const WELL_ARCHITECTED_PUBLICATION_DATE: string = FRAMEWORK.publicationDate;

export const GENERAL_DESIGN_PRINCIPLES: readonly string[] = FRAMEWORK.generalDesignPrinciples;

/** The six pillars in framework order, each with its design principles, questions and best practices. */
export const WELL_ARCHITECTED_PILLARS: readonly Pillar[] = PILLARS.map((p) => {
  const fetched = FRAMEWORK.pillars.find((f) => f.id === p.id);
  if (!fetched) throw new Error(`Well-Architected data has no ${p.id} pillar; run wa:fetch`);
  return { ...fetched, ...p };
});

export const BEST_PRACTICE_IDS: ReadonlySet<string> = new Set(
  WELL_ARCHITECTED_PILLARS.flatMap((p) => p.questions.flatMap((q) => q.bestPractices.map((bp) => bp.id))),
);

/** True for a best-practice ID that exists in the framework, e.g. `REL10-BP01`. */
export function isBestPracticeId(id: string): boolean {
  return BEST_PRACTICE_IDS.has(id);
}

/**
 * The Well-Architected digest as prompt text: pillars with a one-line definition, design principles,
 * and every question and best-practice title with its ID. Titles only, never AWS guidance text.
 */
export function renderWellArchitectedDigest(): string {
  const lines = [
    "# Well-Architected digest",
    `Titles from the AWS Well-Architected Framework (published ${WELL_ARCHITECTED_PUBLICATION_DATE}), adapted under CC BY-SA 4.0; pillar definitions are summaries. Question IDs look like "REL 10", best-practice IDs like "REL10-BP01".`,
    `General design principles: ${GENERAL_DESIGN_PRINCIPLES.join("; ")}.`,
  ];
  for (const p of WELL_ARCHITECTED_PILLARS) {
    lines.push("", `## ${p.id} ${p.name}`, p.definition, `Design principles: ${p.designPrinciples.join("; ")}.`);
    for (const q of p.questions) {
      lines.push(`${q.id} ${q.title}`);
      for (const bp of q.bestPractices) lines.push(`- ${bp.id} ${bp.title}`);
    }
  }
  return lines.join("\n");
}
