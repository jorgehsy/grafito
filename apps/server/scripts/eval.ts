// Eval CLI for the server. It replays saved session records against instructions, and runs architect scenarios, to
// compare prompt changes; only `instruction`, `baseline` and `architect` without --dry call Claude, through the
// route handlers it serves itself.
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { config } from "dotenv";
import { applyOps, emptyBoard, serializeBoard } from "@grafito/board";
import type { Board } from "@grafito/board";
import { ARCHITECT_DEFAULT_MODEL, DEFAULT_LANG, EVAL_MODEL, MODELS, costUsd, isLang, isModelId, parseOp, parseRecord } from "@grafito/contract";
import type { Lang, LiveRecord, Op } from "@grafito/contract";
import { CATALOG_IDS } from "@grafito/icons";
import { buildClients } from "../src/claude/clients";
import { createArchitectHandler } from "../src/routes/architect";
import { createBoardHandler } from "../src/routes/board";
import type { Clients } from "../src/routes/turn";
import { DEFAULT_DIR } from "../src/sessions";
import { languageLine } from "../src/prompt/system";
import { buildUserText } from "../src/prompt/user-text";
import { dryScenario, formatTable, rowFailed, runScenario, saveRecord } from "./architect/run";
import type { StepRow } from "./architect/run";
import { parseScenario } from "./architect/scenario";
import type { Scenario } from "./architect/scenario";
import { convertV1 } from "./convert-v1";
import { readSse } from "./sse";
import type { SseData } from "./sse";
import { serveHandler } from "./serve";

// The .env key wins over one inherited from the shell, as in the server.
config({ override: true, path: fileURLToPath(new URL("../.env", import.meta.url)) });

const USAGE = `Usage: pnpm eval <command> [options]

Commands:
  instruction <record.json> "<instruction>" [--dry] [--upto N] [--model <id>]
      Replay a saved session record and run an instruction against it.
      --dry     print the board, the language line and the user text only, without calling Claude
      --upto N  replay only the first N requests of the record
  baseline <record.json | dir>... [--dry] [--json <out.json>] [--model <id>]
      Run each baseline instruction against each record (the eval of #5: 3 records x 2 instructions)
      and end with a table: invalid ops, missing labels, zones and cost per run.
      --json    also write the results, labels included, to a file
  architect <scenario.json | dir>... [--dry] [--runs N] [--out <dir>] [--model <id>]
      Run architect scenarios (scripted architect sessions) through POST /api/architect and end with a
      table: one row per step and run, pass/fail per check, cost. Exits non-zero if any check fails.
      Each run is saved as an architect session record, openable in the app (Import).
      --dry     print the language line and the user text of each step only, without calling Claude
      --runs N  run each scenario N times (default 1)
      --out     where the records go (default apps/server/sessions, the app's saved sessions)
  All three accept --model <id>: the model to run (default ${EVAL_MODEL}; ${ARCHITECT_DEFAULT_MODEL} for architect).
      Models: ${MODELS.map((m) => m.id).join(", ")}.
      A "@subscription" model runs on your Claude plan (cost "included in plan"): no ANTHROPIC_API_KEY
      and no GRAFITO_SUBSCRIPTION needed, only a logged-in Claude Code.
      e.g. pnpm eval instruction rec.json "..." --model claude-sonnet-5-5@subscription
  convert-v1 <record.json | dir>... --out <dir>
      Convert version 1 session records to the current version (same file names) into <dir>.

Instruction and baseline take live session records (version 2 or 3); an architect record is refused.
Instruction, baseline and architect runs need ANTHROPIC_API_KEY (apps/server/.env) unless the model is a plan model.`;

/** The instructions of the recorded baseline, verbatim: they are what the user said. */
const BASELINE_INSTRUCTIONS = ["separa esto en dos diagramas", "convierte esto en un árbol"];

let MODEL: string = EVAL_MODEL;
let url: string | null = null;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Splits args into positionals and the values of the given flags (a flag listed with `true` takes a value). */
function parseArgs(args: string[], flags: Record<string, boolean>) {
  const positional: string[] = [];
  const values: Record<string, string | true> = {};
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!(a in flags)) positional.push(a);
    else if (!flags[a]) values[a] = true;
    else if (args[k + 1] === undefined) fail(`${a} needs a value\n\n${USAGE}`);
    else values[a] = args[++k];
  }
  return { positional, values };
}

/** Reads `--model` (default EVAL_MODEL) and makes it the model of the runs. */
function pickModel(value: string | true | undefined) {
  if (value === undefined) return;
  if (!isModelId(value)) fail(`Unknown model: ${String(value)}. Models: ${MODELS.map((m) => m.id).join(", ")}`);
  MODEL = value;
}

/** The adapter the model needs, alone; exits with a hint when it is not available. */
function clientsFor(model: string): Clients {
  const provider = MODELS.find((m) => m.id === model)!.provider;
  const clients = buildClients({ apiKey: process.env.ANTHROPIC_API_KEY, subscription: provider === "claude-subscription" });
  if (!clients[provider]) fail(`Missing API key: set ANTHROPIC_API_KEY in apps/server/.env, or use a plan model (--model ${model}@subscription).`);
  return clients;
}

/** Serves the board handler in this process, with only the adapter the model needs; returns its URL. */
async function boardUrl(): Promise<string> {
  url ??= (await serveHandler("/api/board", createBoardHandler(clientsFor(MODEL)))).url;
  return url;
}

const jsonFiles = (paths: string[]) =>
  paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".json")).sort().map((f) => join(p, f)) : [p]));

function loadRecord(file: string): LiveRecord {
  const parsed = parseRecord(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.ok) fail(`${file}: ${parsed.error}${parsed.outdated ? " Convert it first: pnpm eval convert-v1 <file> --out <dir>" : ""}`);
  if (parsed.record.appMode !== "live") fail(`${file}: an architect session record; these commands replay live session records only.`);
  return parsed.record;
}

/** The board after the requests that did not fail, the first `upto` of them (failed ones count). */
function replay(rec: LiveRecord, upto = Infinity): Board {
  let board = emptyBoard();
  for (const r of rec.requests.slice(0, upto)) {
    if (r.error) continue;
    // Recorded ops may carry service icons: parse them with every known catalog on.
    const ops = r.ops.flatMap((o) => {
      const p = parseOp(o, CATALOG_IDS);
      return p.ok ? [p.op] : [];
    });
    board = applyOps(board, ops).board;
  }
  return board;
}

function loadScenario(file: string): Scenario {
  let json: unknown;
  try { json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(`${file}: ${(e as Error).message}`); }
  const parsed = parseScenario(json, basename(file, ".json"));
  if (!parsed.ok) fail(`${file}: ${parsed.error}`);
  return parsed.scenario;
}

const labelsOf = (b: Board) => ({
  elements: b.elements.map((e) => e.label),
  connections: b.connections.filter((c) => c.label).map((c) => c.label as string),
});

interface RunResult {
  record: string;
  instruction: string;
  lang: Lang;
  ops: number;
  invalidOps: number;
  warnings: string[];
  missingElements: string[];
  missingConnections: string[];
  zones: Record<string, number>;
  usd: number | null;
  labels: { zones: string[]; elements: string[]; connections: string[] };
}

/** One instruction against one record. Without `dry` this calls the Claude API through the server. */
async function run(rec: LiveRecord, name: string, instruction: string, opts: { dry: boolean; upto?: number }): Promise<RunResult | null> {
  const board = replay(rec, opts.upto);
  const summary = board.summary || rec.summary || "";
  const original = serializeBoard(board);
  const lang = isLang(rec.speechLang) ? rec.speechLang : DEFAULT_LANG;
  console.log(`===== ${name} | ${instruction}`);

  if (opts.dry) {
    console.log(original);
    console.log("\n--- SYSTEM (last block) ---");
    console.log(languageLine(lang));
    console.log("\n--- USER TEXT (instruction) ---");
    console.log(buildUserText({ board: original, summary, delta: instruction, mode: "instruction" }));
    return null;
  }

  const res = await fetch(await boardUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta: instruction, summary, board: original, model: MODEL, mode: "instruction", lang }),
  });
  if (!res.ok || !res.body) fail(`HTTP ${res.status}`);

  const received: Op[] = [];
  const warnings: string[] = [];
  let invalidOps = 0;
  let done = null as SseData | null;
  await readSse(res.body, (event, d) => {
    if (event === "op") {
      if (d.invalid) {
        invalidOps++;
        warnings.push(d.warning ?? `${d.name}: invalid`);
      } else {
        const p = parseOp(d, []);
        if (p.ok) received.push(p.op);
        else {
          invalidOps++;
          warnings.push(p.error);
        }
        console.log(`${d.name} ${JSON.stringify(d.input)}`);
      }
    } else if (event === "error") warnings.push(`ERROR: ${d.message}`);
    else if (event === "done") done = d;
  });

  const applied = applyOps(board, received);
  const final = applied.board;
  warnings.push(...applied.warnings.map((w) => `apply: ${w}`));
  const usd = done?.usage ? costUsd(MODEL, done.usage) : null;

  console.log("\n--- WARNINGS ---");
  console.log(warnings.length ? warnings.join("\n") : "(none)");
  console.log(`Invalid ops: ${invalidOps} of ${received.length + invalidOps}`);

  console.log("\n--- COST ---");
  if (done) console.log(`${JSON.stringify(done.usage)} ${usd === null ? "included in plan" : `USD ${usd.toFixed(4)}`}`);
  else console.log("(no done event)");

  console.log("\n--- FINAL BOARD ---");
  for (const z of final.zones) {
    console.log(`[${z.kind}] ${z.title}`);
    for (const e of final.elements.filter((x) => x.zone === z.id)) console.log(`  - ${e.label}`);
  }
  const after = labelsOf(final);
  console.log("Labeled connections:");
  for (const l of after.connections) console.log(`  - ${l}`);

  console.log("\n--- CHECK ---");
  const has = (arr: string[], l: string) => arr.some((x) => x.toLowerCase() === l.toLowerCase());
  const before = labelsOf(board);
  const missingElements = [...new Set(before.elements)].filter((l) => !has(after.elements, l));
  const missingConnections = [...new Set(before.connections)].filter((l) => !has(after.connections, l));
  console.log(`Missing elements: ${missingElements.length ? missingElements.join(", ") : "none"}`);
  console.log(`Missing connections: ${missingConnections.length ? missingConnections.join(", ") : "none"}`);
  const zones: Record<string, number> = {};
  for (const z of final.zones) zones[z.kind] = (zones[z.kind] ?? 0) + 1;
  console.log(`Zones: ${final.zones.length} (${zoneText(zones)})`);

  return {
    record: name, instruction, lang, ops: received.length, invalidOps, warnings, missingElements, missingConnections, zones, usd,
    labels: { zones: final.zones.map((z) => z.title), ...after },
  };
}

const zoneText = (zones: Record<string, number>) => Object.entries(zones).map(([k, n]) => `${k}:${n}`).join(", ");

function printTable(results: RunResult[]) {
  console.log("\n--- RESULTS ---");
  console.log("| Record | Instruction | Ops | Invalid ops | Missing elements | Missing connections | Zones | USD |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const usd = r.usd === null ? "?" : r.usd.toFixed(4);
    console.log(`| ${r.record} | ${r.instruction} | ${r.ops} | ${r.invalidOps} | ${r.missingElements.length} | ${r.missingConnections.length} | ${zoneText(r.zones)} | ${usd} |`);
  }
  const invalid = results.reduce((s, r) => s + r.invalidOps, 0);
  const total = results.reduce((s, r) => s + r.ops + r.invalidOps, 0);
  const usd = results.reduce((s, r) => s + (r.usd ?? 0), 0);
  console.log(`\nInvalid-op rate: ${invalid}/${total}${total ? ` (${((100 * invalid) / total).toFixed(1)}%)` : ""}. Total USD ${usd.toFixed(4)}.`);
}

const [command, ...args] = process.argv.slice(2);

if (command === "instruction") {
  const { positional, values } = parseArgs(args, { "--dry": false, "--upto": true, "--model": true });
  const [file, instruction] = positional;
  if (!file || !instruction) fail(USAGE);
  pickModel(values["--model"]);
  const upto = values["--upto"] === undefined ? Infinity : Number(values["--upto"]);
  await run(loadRecord(file), basename(file, ".json"), instruction, { dry: !!values["--dry"], upto });
} else if (command === "baseline") {
  const { positional, values } = parseArgs(args, { "--dry": false, "--json": true, "--model": true });
  if (!positional.length) fail(USAGE);
  pickModel(values["--model"]);
  const files = jsonFiles(positional);
  const results: RunResult[] = [];
  for (const file of files) {
    const rec = loadRecord(file);
    for (const instruction of BASELINE_INSTRUCTIONS) {
      const r = await run(rec, basename(file, ".json"), instruction, { dry: !!values["--dry"] });
      if (r) results.push(r);
    }
  }
  if (values["--dry"]) console.log(`\n(dry run: ${files.length * BASELINE_INSTRUCTIONS.length} requests not sent)`);
  else {
    printTable(results);
    if (typeof values["--json"] === "string") writeFileSync(values["--json"], JSON.stringify(results, null, 2) + "\n");
  }
} else if (command === "architect") {
  const { positional, values } = parseArgs(args, { "--dry": false, "--runs": true, "--out": true, "--model": true });
  if (!positional.length) fail(USAGE);
  MODEL = ARCHITECT_DEFAULT_MODEL;
  pickModel(values["--model"]);
  const runs = values["--runs"] === undefined ? 1 : Number(values["--runs"]);
  if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a whole number of at least 1, got ${String(values["--runs"])}`);
  const out = typeof values["--out"] === "string" ? resolve(values["--out"]) : DEFAULT_DIR;
  const scenarios = jsonFiles(positional).map(loadScenario);
  if (values["--dry"]) {
    for (const sc of scenarios) console.log(dryScenario(sc) + "\n");
    const turns = scenarios.reduce((a, sc) => a + sc.steps.filter((s) => "say" in s).length, 0);
    console.log(`(dry run: ${turns * runs} turns not sent, model ${MODEL})`);
  } else {
    const architect = await serveHandler("/api/architect", createArchitectHandler(clientsFor(MODEL)));
    const rows: StepRow[] = [];
    for (const sc of scenarios) {
      for (let run = 1; run <= runs; run++) {
        console.log(`===== ${sc.name} run ${run}`);
        const r = await runScenario(sc, run, { url: architect.url, model: MODEL });
        rows.push(...r.rows);
        console.log(`saved ${saveRecord(r.record, out)}`);
      }
    }
    console.log(`\n--- RESULTS (${MODEL}) ---`);
    console.log(formatTable(rows));
    if (rows.some(rowFailed)) process.exitCode = 1;
  }
} else if (command === "convert-v1") {
  const { positional, values } = parseArgs(args, { "--out": true });
  const out = values["--out"];
  if (!positional.length || typeof out !== "string") fail(USAGE);
  mkdirSync(out, { recursive: true });
  for (const file of jsonFiles(positional)) {
    const target = join(out, basename(file));
    if (resolve(target) === resolve(file)) fail(`${file}: --out must not be the folder of the input`);
    try {
      const rec = convertV1(JSON.parse(readFileSync(file, "utf8")));
      writeFileSync(target, JSON.stringify(rec, null, 2) + "\n");
      console.log(`${file} -> ${target}`);
    } catch (e) {
      console.error(`${file}: skipped, ${(e as Error).message}`);
    }
  }
} else fail(USAGE);
