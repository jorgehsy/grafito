// Runs architect scenarios for the eval: each say step is one turn through POST /api/architect, each click step
// is resolved on the current board and queued as the next turn's actions. The board between turns is
// replayArchitect over the timeline so far, the code the browser restores with, so the eval sees the board the app would.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lastSay, replayArchitect, serializeBoard } from "@grafito/board";
import type { ArchitectReplay } from "@grafito/board";
import { ARCHITECT_PROMPT_VERSION, RECORD_VERSION, costUsd, parseOp, parseRecord, zeroUsage } from "@grafito/contract";
import type { ArchitectRecord, Op, RecordTurn, TimelineEntry, Usage } from "@grafito/contract";
import { architectSystemPrompt, buildArchitectUserText, RECENT_TURNS } from "../../src/prompt/architect";
import { fileTimestamp } from "../../src/sessions";
import { readSse } from "../sse";
import { checkTurn, EVERY_TURN } from "./checks";
import type { CheckName, TurnChecks } from "./checks";
import { isSay, resolveClick, stepText } from "./scenario";
import type { Scenario } from "./scenario";

/** One row of the results table: one step of one run. */
export interface StepRow {
  scenario: string;
  run: number;
  step: number;
  text: string;
  /** A turn's checks; a click has none. */
  checks: TurnChecks;
  /** The turn's cost; null = included in plan; undefined for a click. */
  usd?: number | null;
  /** The turn broke, or the click could not be resolved. */
  error?: string;
}

export interface ScenarioRun {
  rows: StepRow[];
  record: ArchitectRecord;
}

/** The app names the system zone in its own language; the eval does the same so a saved run looks like the app's. */
export const zoneTitle = (lang: string) => (lang.startsWith("es") ? "Arquitectura" : "Architecture");

const recordUsage = (u: Usage) => ({ input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens });

/** The request body of a turn, as apps/web/src/architect/session.ts builds it from the same board and turns. */
function turnBody(sc: Scenario, replay: ArchitectReplay, text: string, model: string) {
  const { board, turns, pending } = replay;
  const recent = turns.slice(-RECENT_TURNS).map((t) => ({ text: t.entry.text, bubble: lastSay(t.ops)?.text ?? "" }));
  const actions = pending.map(({ type, proposal }) => ({ type, proposal }));
  return { text, board: serializeBoard(board, { catalog: sc.catalogs.length > 0 }), summary: board.summary, recent, actions, model, lang: sc.lang, catalogs: sc.catalogs };
}

/** Runs one scenario once against `url` (POST /api/architect). */
export async function runScenario(sc: Scenario, run: number, opts: { url: string; model: string; fetchImpl?: typeof fetch }): Promise<ScenarioRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const startedAt = Date.now();
  const timeline: TimelineEntry[] = [];
  const rows: StepRow[] = [];
  const now = () => replayArchitect(timeline, zoneTitle(sc.lang));

  for (const [k, step] of sc.steps.entries()) {
    const row: StepRow = { scenario: sc.name, run, step: k + 1, text: stepText(step), checks: {} };
    rows.push(row);
    const replay = now();
    const { board } = replay;
    if (!isSay(step)) {
      const r = resolveClick(board, step);
      if (!r.ok) { row.error = `click: ${r.error}`; continue; }
      row.text += ` (${r.actions.map((a) => `${a.type} ${a.proposal}`).join(", ")})`;
      for (const a of r.actions) timeline.push({ kind: "click", ...a, at: Date.now() });
      continue;
    }

    const turn: RecordTurn = {
      kind: "turn", n: timeline.filter((e) => e.kind === "turn").length + 1, text: step.say, model: opts.model,
      promptVersion: ARCHITECT_PROMPT_VERSION, startedAt: Date.now(), totalMs: null, ops: [], warnings: [], usage: recordUsage(zeroUsage()), costUsd: 0,
    };
    const ops: Op[] = [];
    let usage = zeroUsage();
    const body = turnBody(sc, replay, step.say, opts.model);
    try {
      const res = await fetchImpl(opts.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await readSse(res.body, (event, d) => {
        if (event === "op") {
          if (d.invalid) { turn.warnings.push(d.warning ?? `${d.name}: invalid`); return; }
          const p = parseOp(d, sc.catalogs, "architect");
          if (!p.ok) { turn.warnings.push(p.error); return; }
          ops.push(p.op);
          turn.ops.push({ name: p.op.name, input: p.op.input });
        } else if (event === "usage") usage = { ...zeroUsage(), ...d };
        else if (event === "error") turn.error = d.message ?? "error";
        else if (event === "done") {
          usage = { ...zeroUsage(), ...d.usage };
          turn.totalMs = d.timings?.total_ms ?? null;
          if (typeof d.model === "string") turn.model = d.model;
        }
      });
    } catch (e) {
      turn.error = (e as Error).message;
    }
    if (turn.totalMs === null) turn.totalMs = Date.now() - turn.startedAt;
    const usd = costUsd(turn.model, usage);
    turn.usage = recordUsage(usage);
    turn.costUsd = usd ?? 0;
    timeline.push(turn);
    row.checks = checkTurn(ops, { before: board, expect: step.expect ?? [] });
    row.usd = usd;
    if (turn.error) row.error = turn.error;
  }

  const turns = timeline.filter((e): e is RecordTurn => e.kind === "turn" && !e.error);
  const record: ArchitectRecord = {
    version: RECORD_VERSION, appMode: "architect", id: recordId(sc.name, run, startedAt), startedAt, updatedAt: Date.now(),
    model: opts.model, speechLang: sc.lang, summary: now().board.summary, timeline,
    totals: { requests: turns.length, costUsd: turns.reduce((a, t) => a + t.costUsd, 0), medianVoiceFirstMs: null },
  };
  return { rows, record };
}

/** Unique per run, and safe in a file name (the record id pattern). */
const recordId = (name: string, run: number, t: number) => `eval-${name.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40)}-r${run}-${t.toString(36)}`;

/** Writes the run as a session record, named like the app's saved sessions; returns its path. */
export function saveRecord(rec: ArchitectRecord, dir: string): string {
  const parsed = parseRecord(rec);
  if (!parsed.ok) throw new Error(`eval made an invalid record: ${parsed.error}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fileTimestamp(rec.startedAt)}_${rec.id}.json`);
  writeFileSync(path, JSON.stringify(parsed.record, null, 2) + "\n");
  return path;
}

/**
 * What `--dry` prints for a scenario: per say step, the board, the language line and the user text, as if
 * Claude had drawn nothing and said nothing so far. Clicks are only named: nothing exists to resolve them on.
 */
export function dryScenario(sc: Scenario): string {
  const { board } = replayArchitect([], zoneTitle(sc.lang));
  const lines = [`===== ${sc.name} (${sc.lang}, catalogs: ${sc.catalogs.join(", ") || "none"})`, "--- SYSTEM (last block) ---", architectSystemPrompt({ catalogs: sc.catalogs, lang: sc.lang }).at(-1)!.text];
  const recent: { text: string; bubble: string }[] = [];
  for (const [k, step] of sc.steps.entries()) {
    if (!isSay(step)) { lines.push(`\n--- STEP ${k + 1}: click ${stepText(step)} (resolved at run time) ---`); continue; }
    const expect = step.expect?.length ? ` [expect ${step.expect.join(", ")}]` : "";
    lines.push(`\n--- STEP ${k + 1}: USER TEXT${expect} ---`);
    lines.push(buildArchitectUserText({ board: serializeBoard(board, { catalog: sc.catalogs.length > 0 }), summary: board.summary, recent: recent.slice(-RECENT_TURNS), text: step.say }));
    recent.push({ text: step.say, bubble: "" });
  }
  return lines.join("\n");
}

const COLUMNS: { name: CheckName; title: string }[] = [
  { name: "oneSay", title: "One say" },
  { name: "oneQuestion", title: "≤1 ?" },
  { name: "alternatives", title: "≤2 alts" },
  { name: "bpIds", title: "BP ids" },
];

const mark = (r: TurnChecks[CheckName]) => (!r ? "-" : r.pass === null ? "n/a" : r.pass ? "pass" : "FAIL");
export const rowFailed = (r: StepRow) => !!r.error || Object.values(r.checks).some((c) => c?.pass === false);
const cost = (r: StepRow) => (r.usd === undefined ? "-" : r.usd === null ? "included in plan" : `$${r.usd.toFixed(4)}`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
const short = (s: string) => (s.length > 48 ? `${s.slice(0, 47)}…` : s);

/** The results table (Markdown), then one line per failure or n/a with its reason. */
export function formatTable(rows: readonly StepRow[]): string {
  const out = [
    `| Scenario | Run | Step | Input | ${COLUMNS.map((c) => c.title).join(" | ")} | Expect | Result | Cost |`,
    `|---|---|---|---|${COLUMNS.map(() => "---|").join("")}---|---|---|`,
  ];
  const notes: string[] = [];
  for (const r of rows) {
    const expect = (Object.keys(r.checks) as CheckName[]).filter((n) => !(EVERY_TURN as readonly string[]).includes(n)).map((n) => `${n} ${mark(r.checks[n])}`).join(", ") || "-";
    const turn = Object.keys(r.checks).length > 0;
    out.push(`| ${r.scenario} | ${r.run} | ${r.step} | ${cell(short(r.text))} | ${COLUMNS.map((c) => (turn ? mark(r.checks[c.name]) : "-")).join(" | ")} | ${expect} | ${rowFailed(r) ? "FAIL" : "pass"} | ${cost(r)} |`);
    const at = `${r.scenario} run ${r.run} step ${r.step}`;
    if (r.error) notes.push(`${at}: ${r.error}`);
    for (const [n, c] of Object.entries(r.checks)) if (c?.detail) notes.push(`${at}: ${n} ${mark(c)}: ${c.detail}`);
  }
  const turns = rows.filter((r) => r.usd !== undefined);
  const priced = turns.filter((r) => typeof r.usd === "number");
  const total = priced.length ? `Total USD ${priced.reduce((a, r) => a + (r.usd ?? 0), 0).toFixed(4)}` : turns.length ? "Cost included in plan" : "";
  const failedRows = rows.filter(rowFailed).length;
  return [...out, ...(notes.length ? ["", ...notes] : []), "", `${failedRows ? `${failedRows} of ${rows.length} steps failed` : `All ${rows.length} steps passed`}. ${total}`.trim()].join("\n");
}
