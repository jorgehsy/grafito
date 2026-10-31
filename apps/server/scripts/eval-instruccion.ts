// Evalúa el modo instrucción contra una sesión grabada.
// Uso: npx tsx scripts/eval-instruccion.ts <record.json> "<instrucción>" [--dry] [--upto N]
import { readFileSync } from "node:fs";
import { emptyBoard, applyOps } from "@grafito/board";
import type { Board } from "@grafito/board";
import type { Op } from "@grafito/contract";
import { serializeBoard } from "@grafito/board";
import { costUsd } from "@grafito/contract";
import { buildUserText } from "../src/board";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const ui = args.indexOf("--upto");
const upto = ui >= 0 ? Number(args[ui + 1]) : Infinity;
const [file, instruction] = args.filter((a, k) => a !== "--dry" && a !== "--upto" && (ui < 0 || k !== ui + 1));
if (!file || !instruction) {
  console.error('Uso: npx tsx scripts/eval-instruccion.ts <record.json> "<instrucción>" [--dry] [--upto N]');
  process.exit(1);
}

const URL = "http://localhost:8787/api/board";
const MODEL = "claude-sonnet-5-5";

// Reconstruye el tablero con las ops de los pedidos sin error.
const rec = JSON.parse(readFileSync(file, "utf8"));
let board: Board = emptyBoard();
// --upto N: sólo los primeros N pedidos (cuenta los que fallaron).
for (const r of (rec.requests ?? []).slice(0, upto)) {
  if (r.error) continue;
  const ops = (r.ops ?? []).filter((o: any) => o && o.name && !o.invalid) as Op[];
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

// Parseo SSE simple: bloques separados por línea en blanco.
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
      received.push({ name: d.name, input: d.input } as Op);
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
warnings.push(...applied.warnings.map((w) => `aplicar: ${w}`));

console.log("\n--- AVISOS ---");
console.log(warnings.length ? warnings.join("\n") : "(ninguno)");

console.log("\n--- COSTO ---");
if (done) console.log(`${JSON.stringify(done.usage)} USD ${costUsd(MODEL, done.usage).toFixed(4)}`);
else console.log("(sin done)");

console.log("\n--- TABLERO FINAL ---");
for (const z of final.zones) {
  console.log(`[${z.kind}] ${z.title}`);
  for (const e of final.elements.filter((x) => x.zone === z.id)) console.log(`  - ${e.label}`);
}
const connections = final.connections.filter((c) => c.label);
console.log("Conexiones con etiqueta:");
for (const c of connections) console.log(`  - ${c.label}`);

console.log("\n--- CHEQUEO ---");
const has = (arr: string[], l: string) => arr.some((x) => x.toLowerCase() === l.toLowerCase());
const after = labelsOf(final);
const missingElements = [...new Set(before.elements)].filter((l) => !has(after.elements, l));
const missingConnections = [...new Set(before.connections)].filter((l) => !has(after.connections, l));
console.log(`Elementos que faltan: ${missingElements.length ? missingElements.join(", ") : "ninguno"}`);
console.log(`Conexiones que faltan: ${missingConnections.length ? missingConnections.join(", ") : "ninguna"}`);
const kinds: Record<string, number> = {};
for (const z of final.zones) kinds[z.kind] = (kinds[z.kind] ?? 0) + 1;
console.log(`Zonas: ${final.zones.length} (${Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(", ")})`);
