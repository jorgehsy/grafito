// Architect scenarios (GLOSSARY): a scripted architect session for the eval. A file is a JSON list of steps, or
// `{ name?, lang?, catalogs?, steps }` when the session needs a language or catalogs other than the defaults.
// A click names its proposal by meaning; it is resolved to Claude's real ids on the board at run time.
import { z } from "zod";
import { openProposals } from "@grafito/board";
import type { Board } from "@grafito/board";
import { DEFAULT_LANG, isLang } from "@grafito/contract";
import type { Lang, ProposalClick } from "@grafito/contract";
import { isCatalogId } from "@grafito/icons";

export const EXPECTS = ["ink", "pencil", "bubbleOnly", "asksKeep", "review"] as const;
export type Expect = (typeof EXPECTS)[number];

/** Architect mode is about AWS, so the eval runs with its icons on unless the scenario says otherwise. */
export const DEFAULT_CATALOGS = ["aws"];

const which = z.enum(["all", "newest"]);
const STEP_SCHEMAS = {
  say: z.strictObject({
    say: z.string().trim().min(1, "must not be blank"),
    expect: z
      .array(z.enum(EXPECTS))
      .optional()
      .refine((e) => !(e?.includes("ink") && e.includes("pencil")), "ink and pencil exclude each other")
      .refine((e) => !(e?.includes("bubbleOnly") && (e.includes("ink") || e.includes("pencil"))), "bubbleOnly excludes ink and pencil"),
  }),
  accept: z.strictObject({ accept: which }),
  reject: z.strictObject({ reject: which }),
  /** Which of the two open alternatives, 1 = A, 2 = B, in the order PROPOSALS lists them. */
  choose: z.strictObject({ choose: z.union([z.literal(1), z.literal(2)]) }),
};

export type SayStep = z.output<typeof STEP_SCHEMAS.say>;
export type ClickStep = z.output<typeof STEP_SCHEMAS.accept> | z.output<typeof STEP_SCHEMAS.reject> | z.output<typeof STEP_SCHEMAS.choose>;
export type Step = SayStep | ClickStep;

export interface Scenario {
  name: string;
  lang: Lang;
  catalogs: string[];
  steps: Step[];
}

const wrapperSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "letters, digits, - and _ only, at most 40").optional(),
  lang: z.string().refine(isLang, "unknown language tag").optional(),
  catalogs: z.array(z.string().refine(isCatalogId, "unknown catalog")).optional(),
  steps: z.array(z.unknown()),
});

const issueText = (e: z.ZodError) => e.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");

function parseStep(x: unknown, n: number): Step {
  const kind = x && typeof x === "object" ? (Object.keys(STEP_SCHEMAS) as (keyof typeof STEP_SCHEMAS)[]).find((k) => k in x) : undefined;
  if (!kind) throw new Error(`step ${n}: expected {"say": "..."}, {"accept": "all" | "newest"}, {"reject": "all" | "newest"} or {"choose": 1 | 2}`);
  const r = STEP_SCHEMAS[kind].safeParse(x);
  if (!r.success) throw new Error(`step ${n} (${kind}): ${issueText(r.error)}`);
  return r.data;
}

/** Parses a scenario file's JSON. `fallbackName` (the file name) is used when the file names none. */
export function parseScenario(x: unknown, fallbackName: string): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  try {
    let head: z.output<typeof wrapperSchema>;
    if (Array.isArray(x)) head = { steps: x };
    else {
      const r = wrapperSchema.safeParse(x);
      if (!r.success) throw new Error(issueText(r.error));
      head = r.data;
    }
    if (!head.steps.length) throw new Error("no steps");
    const steps = head.steps.map((s, k) => parseStep(s, k + 1));
    // Claude makes the proposals, so nothing can be clicked before its first turn.
    if (!("say" in steps[0])) throw new Error("step 1: the first step must be a say");
    return {
      ok: true,
      scenario: { name: head.name ?? fallbackName, lang: (head.lang as Lang | undefined) ?? DEFAULT_LANG, catalogs: head.catalogs ?? DEFAULT_CATALOGS, steps },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const isSay = (s: Step): s is SayStep => "say" in s;

/** The step as the table shows it. */
export function stepText(s: Step): string {
  if (isSay(s)) return s.say;
  if ("choose" in s) return `choose ${s.choose === 1 ? "A" : "B"}`;
  return "accept" in s ? `accept ${s.accept}` : `reject ${s.reject}`;
}

/**
 * The clicks a click step makes on this board, in order. "all" accepts every open proposal that has no
 * alternative (choosing between two is `choose`), or rejects every open one; "newest" is the last one opened;
 * `choose N` accepts alternative N of the newest open pair.
 */
export function resolveClick(board: Board, step: ClickStep): { ok: true; actions: ProposalClick[] } | { ok: false; error: string } {
  const open = openProposals(board);
  if (!open.length) return { ok: false, error: "no open proposal" };
  if ("choose" in step) {
    const pair = [...open].reverse().find((p) => p.alternatives.length > 1);
    return pair ? { ok: true, actions: [{ type: "accept", proposal: pair.alternatives[step.choose - 1] }] } : { ok: false, error: "no two alternatives are open" };
  }
  const type = "accept" in step ? "accept" : "reject";
  const what = "accept" in step ? step.accept : step.reject;
  if (what === "newest") return { ok: true, actions: [{ type, proposal: open.at(-1)!.id }] };
  const ids = open.filter((p) => type === "reject" || !p.alternatives.length).map((p) => p.id);
  return ids.length ? { ok: true, actions: ids.map((proposal) => ({ type, proposal })) } : { ok: false, error: "only alternatives are open: use choose" };
}
