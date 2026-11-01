export type PillarId = "OPS" | "SEC" | "REL" | "PERF" | "COST" | "SUS";

export type BestPractice = {
  /** e.g. `REL10-BP01` */
  id: string;
  title: string;
};

export type Question = {
  /** e.g. `REL 10` */
  id: string;
  title: string;
  bestPractices: BestPractice[];
};

/** What the refresh script extracts for one pillar: titles only, in framework order. */
export type FetchedPillar = {
  id: PillarId;
  designPrinciples: string[];
  questions: Question[];
};

/** The shape of the generated `framework.generated.ts`. */
export type FetchedFramework = {
  /** As printed on the framework's welcome page, e.g. `November 6, 2024`. */
  publicationDate: string;
  generalDesignPrinciples: string[];
  pillars: FetchedPillar[];
};

export type Pillar = FetchedPillar & {
  name: string;
  /** One line in our own words, not AWS text. */
  definition: string;
};
