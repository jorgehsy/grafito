// Eval CLI for the server. Subcommands:
//   instruction  Replay a saved session record and run an instruction against it (calls the Claude API unless --dry).
import { readFileSync } from "node:fs";
import { emptyBoard, applyOps } from "@grafito/board";
import type { Board } from "@grafito/board";
import type { Op } from "@grafito/contract";
import { serializeBoard } from "@grafito/board";
import { CATALOG_IDS, costUsd, parseOp } from "@grafito/contract";
import { buildUserText } from "../src/prompt/user-text";

const USAGE = `Usage: pnpm eval <command> [options]

Commands:
  instruction <record.json> "<instruction>" [--dry] [--upto N]
      Replay a saved session record and run an instruction against it.
      --dry     print the board and the user text only, without calling Claude
      --upto N  replay only the first N requests of the record`;

const [command, ...args] = process.argv.slice(2);
if (command !== "instruction") {
  console.error(USAGE);
  process.exit(1);
}
const dry = args.includes("--dry");
const ui = args.indexOf("--upto");
const upto = ui >= 0 ? Number(args[ui + 1]) : Infinity;
const [file, instruction] = args.filter((a, k) => a !== "--dry" && a !== "--upto" && (ui < 0 || k !== ui + 1));
if (!file || !instruction) {
  console.error(USAGE);
  process.exit(1);
}

const URL = "http://localhost:8787/api/board";
const MODEL = "claude-sonnet-5-5";

// Rebuild the board from the ops of the requests that did not fail.
const rec = JSON.parse(readFileSync(file, "utf8"));
let board: Board = emptyBoard();
// --upto N: only the first N requests (failed ones count).
for (const r of (rec.requests ?? []).slice(0, upto)) {
  if (r.error) continue;
  // Recorded ops may carry service icons: parse them with every known catalog on.
  const ops = (r.ops ?? []).flatMap((o: unknown) => {
    const p = parseOp(o, CATALOG_IDS);
    return p.ok ? [p.op] : [];
  });
  board = applyOps(board, ops).board;
}
const summary: string = board.summary || rec.summary || "";
const original = serializeBoard(board);

if (dry) {
  console.log(original);
  console.log("\n--- USER TEXT (instruction) ---");
  console.log(buildUserText({ board: original, summary, delta: instruction, mode: "instruction" }));
  process.exit(0);
}

const labelsOf = (b: Board) => ({
  elements: b.elements.map((e) => e.label),
  connections: b.connections.filter((c) => c.label).map((c) => c.label as string),
});
const before = labelsOf(board);

const res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ delta: instruction, summary, board: original, model: MODEL, mode: "instruction" }),
});
if (!res.ok || !res.body) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}

// Simple SSE parsing: blocks separated by a blank line.
const received: Op[] = [];
const warnings: string[] = [];
let done: any = null;
let buf = "";
const handle = (chunk: string) => {
  let event = "message";
  let data = "";
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return;
  const d = JSON.parse(data);
  if (event === "op") {
    if (d.invalid) warnings.push(d.warning);
    else {
      const p = parseOp(d, []);
      if (p.ok) received.push(p.op);
      else warnings.push(p.error);
      console.log(`${d.name} ${JSON.stringify(d.input)}`);
    }
  } else if (event === "error") warnings.push(`ERROR: ${d.message}`);
  else if (event === "done") done = d;
};
const decoder = new TextDecoder();
for await (const part of res.body as any) {
  buf += decoder.decode(part, { stream: true });
  let i: number;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    handle(buf.slice(0, i));
    buf = buf.slice(i + 2);
  }
}
if (buf.trim()) handle(buf);

const applied = applyOps(board, received);
const final = applied.board;
warnings.push(...applied.warnings.map((w) => `apply: ${w}`));

console.log("\n--- WARNINGS ---");
console.log(warnings.length ? warnings.join("\n") : "(none)");

console.log("\n--- COST ---");
if (done) console.log(`${JSON.stringify(done.usage)} USD ${costUsd(MODEL, done.usage).toFixed(4)}`);
else console.log("(no done event)");

console.log("\n--- FINAL BOARD ---");
for (const z of final.zones) {
  console.log(`[${z.kind}] ${z.title}`);
  for (const e of final.elements.filter((x) => x.zone === z.id)) console.log(`  - ${e.label}`);
}
const connections = final.connections.filter((c) => c.label);
console.log("Labeled connections:");
for (const c of connections) console.log(`  - ${c.label}`);

console.log("\n--- CHECK ---");
const has = (arr: string[], l: string) => arr.some((x) => x.toLowerCase() === l.toLowerCase());
const after = labelsOf(final);
const missingElements = [...new Set(before.elements)].filter((l) => !has(after.elements, l));
const missingConnections = [...new Set(before.connections)].filter((l) => !has(after.connections, l));
console.log(`Missing elements: ${missingElements.length ? missingElements.join(", ") : "none"}`);
console.log(`Missing connections: ${missingConnections.length ? missingConnections.join(", ") : "none"}`);
const kinds: Record<string, number> = {};
for (const z of final.zones) kinds[z.kind] = (kinds[z.kind] ?? 0) + 1;
console.log(`Zones: ${final.zones.length} (${Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(", ")})`);
