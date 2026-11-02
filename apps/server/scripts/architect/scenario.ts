// Architect scenarios (GLOSSARY): a scripted architect session for the eval. A file is a JSON list of steps, or
// `{ name?, lang?, catalogs?, start?, steps }` when the session needs a language, catalogs or a starting board.
// A click names its proposal by meaning; it is resolved to Claude's real ids on the board at run time.
import { z } from "zod";
import { openProposals, replayArchitect } from "@grafito/board";
import type { Board } from "@grafito/board";
import { ARCHITECT_PROMPT_VERSION, DEFAULT_LANG, isLang, parseOp } from "@grafito/contract";
import type { Lang, Op, ProposalClick, RecordTurn } from "@grafito/contract";
import { catalogServiceIds, isCatalogId } from "@grafito/icons";

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
    /** The services the user names, one per component (two Lambdas = "lambda" twice): the ink check wants each in ink. */
    asked: z.array(z.string().min(1)).min(1).optional(),
  }).refine((s) => !s.asked || s.expect?.includes("ink"), { message: "asked needs expect ink", path: ["asked"] }),
  accept: z.strictObject({ accept: which }),
  reject: z.strictObject({ reject: which }),
  /** Which of the two open alternatives, 1 = A, 2 = B, in the order PROPOSALS lists them. */
  choose: z.strictObject({ choose: z.union([z.literal(1), z.literal(2)]) }),
};

export type SayStep = z.output<typeof STEP_SCHEMAS.say>;
export type ClickStep = z.output<typeof STEP_SCHEMAS.accept> | z.output<typeof STEP_SCHEMAS.reject> | z.output<typeof STEP_SCHEMAS.choose>;
export type Step = SayStep | ClickStep;

/**
 * A scripted first turn: what the user said and the ops Claude "answered" with, never sent to Claude. It sets up
 * the board a step needs (three open proposals for asksKeep) without depending on what earlier real turns drew.
 */
export interface ScenarioStart {
  say: string;
  ops: Op[];
}

export interface Scenario {
  name: string;
  lang: Lang;
  catalogs: string[];
  start?: ScenarioStart;
  steps: Step[];
}

/** The model a scripted start turn is recorded with: it shows in the record that no model made it. */
export const SCRIPTED_MODEL = "scripted";

const wrapperSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "letters, digits, - and _ only, at most 40").optional(),
  lang: z.string().refine(isLang, "unknown language tag").optional(),
  catalogs: z.array(z.string().refine(isCatalogId, "unknown catalog")).optional(),
  start: z.strictObject({ say: z.string().trim().min(1, "must not be blank"), ops: z.array(z.unknown()).min(1) }).optional(),
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
    const catalogs = head.catalogs ?? DEFAULT_CATALOGS;
    const steps = head.steps.map((s, k) => parseStep(s, k + 1));
    // Claude (or the scripted start) makes the proposals, so nothing can be clicked before the first turn.
    if (!head.start && !("say" in steps[0])) throw new Error("step 1: the first step must be a say");
    const services = new Set(catalogServiceIds(catalogs));
    for (const [k, s] of steps.entries()) {
      const unknown = (isSay(s) ? s.asked ?? [] : []).filter((id) => !services.has(id));
      if (unknown.length) throw new Error(`step ${k + 1} (say): asked: not a service of ${catalogs.join(", ") || "no catalog"}: ${unknown.join(", ")}`);
    }
    const start = head.start && parseStart(head.start, catalogs);
    const lang = (head.lang as Lang | undefined) ?? DEFAULT_LANG;
    return { ok: true, scenario: { name: head.name ?? fallbackName, lang, catalogs, ...(start ? { start } : {}), steps } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const isSay = (s: Step): s is SayStep => "say" in s;

/** Each start op must be a valid architect op that the board takes without a warning. */
function parseStart(raw: { say: string; ops: unknown[] }, catalogs: string[]): ScenarioStart {
  const ops = raw.ops.map((x, k) => {
    const p = parseOp(x, catalogs, "architect");
    if (!p.ok) throw new Error(`start.ops.${k}: ${p.error}`);
    return p.op;
  });
  const start = { say: raw.say, ops };
  const { warnings } = replayArchitect(startTimeline(start, 0), "Architecture");
  if (warnings.length) throw new Error(`start: ${warnings.join("; ")}`);
  return start;
}

/** The timeline a scenario's session begins with: its scripted start as turn 1, or nothing. */
export function startTimeline(start: ScenarioStart | undefined, at: number): RecordTurn[] {
  if (!start) return [];
  return [{
    kind: "turn", n: 1, text: start.say, model: SCRIPTED_MODEL, promptVersion: ARCHITECT_PROMPT_VERSION, startedAt: at, totalMs: 0,
    ops: start.ops.map(({ name, input }) => ({ name, input })), warnings: [],
    usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, costUsd: 0,
  }];
}

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
