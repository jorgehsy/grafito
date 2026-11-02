import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayArchitect } from "@grafito/board";
import { parseRecord } from "@grafito/contract";
import { fakeClaude, start, stop, toolBlock } from "../../src/claude/fake";
import type { FakeAttempt } from "../../src/claude/fake";
import { createArchitectHandler } from "../../src/routes/architect";
import { serveHandler } from "../serve";
import { dryScenario, formatTable, rowFailed, runScenario, saveRecord, stepVerdicts } from "./run";
import type { StepRow } from "./run";
import { parseScenario } from "./scenario";
import type { Scenario } from "./scenario";

// End to end: the real architect handler in this process, the fake Claude adapter behind it.

let close: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await close?.();
  close = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function serveFake(script: FakeAttempt[]) {
  const fake = fakeClaude(script);
  const s = await serveHandler("/api/architect", createArchitectHandler({ "anthropic-api": fake }));
  close = s.close;
  return { fake, url: s.url };
}

const turn = (calls: [string, unknown][], output = 100): FakeAttempt => [
  start({ input_tokens: 1000, cache_read_input_tokens: 20000 }),
  ...calls.flatMap(([name, input], k) => toolBlock(k, name, JSON.stringify(input))),
  ...stop("tool_use", output),
];
const comp = (id: string, type: string, service: string, proposal?: string) => ({ zone: "system", id, label: id, type, service, ...(proposal ? { proposal } : {}) });

const scenario = (x: unknown): Scenario => {
  const r = parseScenario(x, "rds-or-dynamo");
  if (!r.ok) throw new Error(r.error);
  return r.scenario;
};

const SCENARIO = scenario([
  { say: "An online store needs a database. RDS or DynamoDB?", expect: ["pencil"] },
  { choose: 2 },
  { say: "Add an SQS queue for orders.", expect: ["ink"] },
]);

const SCRIPT: FakeAttempt[] = [
  turn([
    ["propose", { id: "P1", label: "Relational" }],
    ["add_component", comp("rds", "database", "rds", "P1")],
    ["propose", { id: "P2", label: "Key-value", alternative_to: "P1" }],
    ["add_component", comp("ddb", "database", "dynamodb", "P2")],
    ["say", { text: "A is RDS, B is DynamoDB. Do your orders need joins?", target: "P1" }],
    ["update_summary", { text: "Offered RDS (A) or DynamoDB (B)." }],
  ]),
  turn([
    ["add_component", comp("orders", "queue", "sqs")],
    ["say", { text: "Kept DynamoDB. Orders now go through a queue. What reads it? And when?" }],
    ["update_summary", { text: "DynamoDB and an orders queue." }],
  ]),
];

describe("runScenario", () => {
  it("runs each say as a turn, resolves the click on Claude's ids and checks every turn", async () => {
    const { fake, url } = await serveFake(SCRIPT);
    const { rows, record } = await runScenario(SCENARIO, 1, { url, model: "claude-sonnet-5-5" });

    expect(rows.map((r) => [r.step, r.text, r.clicks])).toEqual([
      [1, "An online store needs a database. RDS or DynamoDB?", undefined],
      [2, "choose B", "accept P2"],
      [3, "Add an SQS queue for orders.", undefined],
    ]);
    expect(rows[0].checks).toEqual({ oneSay: { pass: true }, oneQuestion: { pass: true }, alternatives: { pass: true }, bpIds: { pass: true }, pencil: { pass: true } });
    expect(rows[0].usd).toBeGreaterThan(0);
    expect(rows[1].checks).toEqual({});
    expect(rows[1].usd).toBeUndefined();
    expect(rows[2].checks).toMatchObject({ oneQuestion: { pass: false, detail: "2 questions" }, ink: { pass: true } });
    expect(rows.map(rowFailed)).toEqual([false, false, true]);

    // The second turn carries the click as its action and sees the chosen alternative in ink.
    const second = fake.calls[1].params.userText;
    expect(second).toContain("USER CLICKS SINCE LAST TURN:\n- accept P2");
    expect(second).toContain("USER: An online store needs a database. RDS or DynamoDB?\nYOUR BUBBLE: A is RDS, B is DynamoDB.");
    expect(second).toContain("ddb");
    expect(second).not.toContain("rds");
    expect(fake.calls[0].params.catalogs).toEqual(["aws"]);

    // The run is a valid v3 architect record that replays to the same board.
    expect(parseRecord(record)).toMatchObject({ ok: true, record: { appMode: "architect", speechLang: "en-US", summary: "DynamoDB and an orders queue." } });
    expect(record.timeline.map((e) => e.kind)).toEqual(["turn", "click", "turn"]);
    expect(record.timeline[1]).toMatchObject({ kind: "click", type: "accept", proposal: "P2" });
    expect(record.totals.requests).toBe(2);
    const board = replayArchitect(record.timeline, "Architecture").board;
    expect(board.elements.map((e) => [e.id, e.proposal])).toEqual([["ddb", undefined], ["orders", undefined]]);

    const table = formatTable(rows);
    expect(table).toContain("| rds-or-dynamo | 1 | 1 | An online store needs a database. RDS or Dynamo… | pass | pass | pass | pass | pencil pass | pass | $");
    expect(table).toContain("| rds-or-dynamo | 1 | 2 | choose B (accept P2) | - | - | - | - | - | pass | - |");
    expect(table).toContain("| rds-or-dynamo | 1 | 3 | Add an SQS queue for orders. | pass | FAIL | pass | pass | ink pass | FAIL | $");
    expect(table).toContain("rds-or-dynamo run 1 step 3: oneQuestion FAIL: 2 questions");
    expect(table).toContain("| rds-or-dynamo | 3 | Add an SQS queue for orders. | 0/1 | oneQuestion 1/1 | FAIL |");
    expect(table).toContain("1 of 3 steps failed.");

    const dir = mkdtempSync(join(tmpdir(), "grafito-eval-"));
    dirs.push(dir);
    const path = saveRecord(record, dir);
    expect(path).toMatch(/\/\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_eval-rds-or-dynamo-r1-[a-z0-9]+\.json$/);
    expect(parseRecord(JSON.parse(readFileSync(path, "utf8"))).ok).toBe(true);
  });

  it("fails a click it cannot resolve and a turn that breaks, and goes on", async () => {
    const { url } = await serveFake([turn([["say", { text: "What is it for?" }]])]);
    const { rows, record } = await runScenario(scenario([{ say: "build me something" }, { choose: 1 }, { say: "a shop" }]), 2, { url, model: "claude-sonnet-5-5" });
    expect(rows[1]).toMatchObject({ text: "choose A", error: "click: no open proposal" });
    expect(rows[2].error).toContain("fake: no attempt scripted");
    expect(rows[2].checks.oneSay).toEqual({ pass: false, detail: "no say" });
    expect(record.timeline.map((e) => e.kind)).toEqual(["turn", "turn"]);
    expect(record.totals.requests).toBe(1);
    expect(parseRecord(record).ok).toBe(true);
  });

  it("starts from the scripted start turn without sending it, and checks asked services in ink", async () => {
    const { fake, url } = await serveFake([
      turn([
        ["add_component", comp("mods", "actor", "")],
        ["add_component", comp("queue", "queue", "sqs")],
        ["say", { text: "Keep these three before we go on?" }],
      ]),
    ]);
    const sc = scenario({
      start: {
        say: "A photo app.",
        ops: [
          { name: "propose", input: { id: "P1", label: "Core" } },
          { name: "add_component", input: comp("photos", "storage", "s3", "P1") },
          { name: "propose", input: { id: "P2", label: "Copy" } },
          { name: "add_component", input: comp("replica", "storage", "s3", "P2") },
          { name: "propose", input: { id: "P3", label: "Sign-in" } },
          { name: "add_component", input: comp("auth", "service", "cognito", "P3") },
          { name: "say", input: { text: "Sketched three things. Public photos?" } },
        ],
      },
      steps: [{ say: "Moderators review reports through a queue.", expect: ["ink", "asksKeep"], asked: ["sqs", "lambda"] }],
    });
    const { rows, record } = await runScenario(sc, 1, { url, model: "claude-sonnet-5-5" });

    expect(fake.calls).toHaveLength(1);
    const text = fake.calls[0].params.userText;
    expect(text).toContain("USER: A photo app.\nYOUR BUBBLE: Sketched three things. Public photos?");
    expect(text).toContain("[pencil P3]");
    expect(rows.map((r) => r.step)).toEqual([1]);
    expect(rows[0].checks).toMatchObject({ asksKeep: { pass: true }, ink: { pass: false, detail: "not in ink: lambda" } });
    expect(record.timeline.map((e) => e.kind === "turn" && e.model)).toEqual(["scripted", "claude-sonnet-5-5"]);
    expect(record.totals.requests).toBe(1);
    expect(parseRecord(record).ok).toBe(true);
  });

  it("shows a plan model's cost as included in plan", async () => {
    const fake = fakeClaude([turn([["say", { text: "Hi." }]])]);
    const s = await serveHandler("/api/architect", createArchitectHandler({ "claude-subscription": fake }));
    close = s.close;
    const { rows } = await runScenario(scenario([{ say: "hi" }]), 1, { url: s.url, model: "claude-sonnet-5-5@subscription" });
    expect(rows[0].usd).toBeNull();
    expect(formatTable(rows)).toContain("| included in plan |");
    expect(formatTable(rows)).toContain("Cost included in plan");
  });
});

describe("stepVerdicts", () => {
  const row = (run: number, step: number, fail?: "oneQuestion" | "error"): StepRow => ({
    scenario: "s", run, step, text: `step ${step}`,
    checks: { oneSay: { pass: true }, oneQuestion: fail === "oneQuestion" ? { pass: false, detail: "2 questions" } : { pass: true } },
    ...(fail === "error" ? { error: "HTTP 500" } : {}),
  });

  it("passes a step that passes in most of its runs, and counts each failing check", () => {
    const rows = [row(1, 1), row(1, 2, "oneQuestion"), row(2, 1, "error"), row(2, 2, "oneQuestion"), row(3, 1), row(3, 2)];
    expect(stepVerdicts(rows)).toEqual([
      { scenario: "s", step: 1, text: "step 1", runs: 3, passed: 2, failing: { error: 1 }, pass: true },
      { scenario: "s", step: 2, text: "step 2", runs: 3, passed: 1, failing: { oneQuestion: 2 }, pass: false },
    ]);
    const table = formatTable(rows);
    expect(table).toContain("| s | 1 | step 1 | 2/3 | error 1/3 | pass |");
    expect(table).toContain("| s | 2 | step 2 | 1/3 | oneQuestion 2/3 | FAIL |");
    expect(table).toContain("1 of 2 steps failed (a step passes when it passes in most of its runs).");
  });

  it("needs both runs of two, and the one run of one", () => {
    expect(stepVerdicts([row(1, 1), row(2, 1, "oneQuestion")])[0].pass).toBe(false);
    expect(stepVerdicts([row(1, 1, "oneQuestion")])[0].pass).toBe(false);
    expect(stepVerdicts([row(1, 1)])[0].pass).toBe(true);
  });
});

describe("dryScenario", () => {
  it("prints the language line and each step's user text, naming clicks", () => {
    const text = dryScenario(scenario({ lang: "es-CL", steps: [{ say: "una app web", expect: ["pencil"] }, { accept: "all" }, { say: "y una cola" }] }));
    expect(text).toContain("===== rds-or-dynamo (es-CL, catalogs: aws)");
    expect(text).toContain("Spanish");
    expect(text).toContain("--- STEP 1: USER TEXT [expect pencil] ---\nCURRENT BOARD:\nZONES\n- system [system] \"Arquitectura\"");
    expect(text).toContain("--- STEP 2: click accept all (resolved at run time) ---");
    expect(text).toContain("USER: una app web\nYOUR BUBBLE: (none)\n\nUSER MESSAGE:\ny una cola");
  });

  it("shows the scripted start, its board and its bubble, and the asked services", () => {
    const text = dryScenario(scenario({
      start: { say: "a photo app", ops: [{ name: "propose", input: { id: "P1", label: "Core" } }, { name: "add_component", input: comp("photos", "storage", "s3", "P1") }, { name: "say", input: { text: "Public?" } }] },
      steps: [{ say: "add a queue", expect: ["ink"], asked: ["sqs"] }],
    }));
    expect(text).toContain("--- START (scripted, not sent): a photo app ---");
    expect(text).toContain("--- STEP 1: USER TEXT [expect ink, asked sqs] ---");
    expect(text).toContain("[pencil P1]");
    expect(text).toContain("USER: a photo app\nYOUR BUBBLE: Public?");
  });
});
