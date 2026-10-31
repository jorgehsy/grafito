// Compact serialization of the board for the prompt (no layout or coordinates).
import type { Board } from "./model";
import { FILL_NAMES } from "./palette";

const q = (s: string) => JSON.stringify(s);

export interface SerializeOpts {
  /** Icon catalog turned on: shows ` service:lambda` per element. Off: not shown. */
  catalog?: boolean;
}

// Spanish on purpose: prompt text, translated with the English prompt ticket.
export function serializeBoard(b: Board, opts: SerializeOpts = {}): string {
  if (!b.zones.length && !b.elements.length) return "(tablero vacío)";
  const out: string[] = [];
  out.push("ZONAS");
  for (const z of b.zones) {
    let l = `- ${z.id} [${z.kind}] ${q(z.title)}`;
    if (z.leftTitle || z.rightTitle) l += ` (${z.leftTitle ?? ""} | ${z.rightTitle ?? ""})`;
    if (z.kind === "scale") {
      l += ` (${z.minLabel ?? "0%"} .. ${z.maxLabel ?? "100%"})`;
      if (z.level) l += ` nivel:${z.level.at}${z.level.label ? " " + q(z.level.label) : ""}`;
    }
    if (z.kind === "cycle" && z.centerLabel) l += ` centro:${q(z.centerLabel)}`;
    if (z.place) l += ` place:${z.place.relation} ${z.place.of}`;
    l += ` color:${FILL_NAMES[z.n % FILL_NAMES.length]}`;
    out.push(l);
  }
  out.push("ELEMENTOS");
  for (const e of b.elements) {
    const kind = e.type === "component" ? `component/${e.comp ?? "service"}` : e.type;
    // tree nodes: indent by depth so the hierarchy shows
    let depth = 0;
    for (let p = e.type === "branch" ? e.parent : undefined; p && depth < 20; depth++) p = b.elements.find((x) => x.id === p)?.parent;
    let l = `- ${"  ".repeat(depth)}${e.id} (${kind}) ${q(e.label)} @${e.zone}`;
    if (e.type === "mark") l += ` at:${e.at} tone:${e.tone ?? "neutral"}${e.note ? " nota:" + q(e.note) : ""}`;
    if (e.type === "event") l += `${e.at !== undefined ? ` at:${e.at}` : ""}${e.when ? " when:" + q(e.when) : ""}${e.note ? " nota:" + q(e.note) : ""}`;
    if (e.type === "span") l += ` from:${e.at} to:${e.to} tone:${e.tone ?? "neutral"}`;
    if ((e.type === "stage" || e.type === "branch") && e.note) l += ` nota:${q(e.note)}`;
    if (e.column) l += ` col:${e.column}`;
    if (e.after) l += ` after:${e.after}`;
    if (e.parent) l += ` parent:${e.parent}`;
    if (opts.catalog && e.service) l += ` service:${e.service.slice(e.service.indexOf(":") + 1)}`;
    out.push(l);
  }
  if (b.connections.length) {
    out.push("CONEXIONES");
    for (const c of b.connections) {
      out.push(`- ${c.id}: ${c.from} ${c.both ? "<->" : "->"} ${c.to}${c.label ? " " + q(c.label) : ""}${c.style === "dashed" ? " dashed" : ""}`);
    }
  }
  if (b.callouts.length) {
    out.push("NOTAS");
    for (const c of b.callouts) out.push(`- ${c.id} -> ${c.target} ${q(c.text)}`);
  }
  const marks: string[] = [];
  for (const e of b.emphasis) marks.push(`${e.target}:${e.style}`);
  for (const k of b.questions) marks.push(`${k.target}:?`);
  if (marks.length) out.push("MARCAS " + marks.join(", "));
  return out.join("\n");
}
