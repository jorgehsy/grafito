// Pure board model. No React, no coordinates.
import { MARK_TONES, TEXT_FIELDS, ZONE_KINDS } from "@grafito/contract";
import { AWS_CATALOG_ID, AWS_SERVICES } from "@grafito/icons";
import type { ComponentType, EmphasisStyle, MarkTone, Op, ZoneKind } from "@grafito/contract";

export interface Zone {
  id: string;
  kind: ZoneKind;
  title: string;
  leftTitle?: string;
  rightTitle?: string;
  /** scale: labels at the ends of the bar and the current level (fill). */
  minLabel?: string;
  maxLabel?: string;
  level?: { at: number; label?: string };
  /** cycle: center text. */
  centerLabel?: string;
  place?: { relation: "right_of" | "below"; of: string };
  /** Creation order number (gives the zone a stable color). */
  n: number;
}
export type ElementType = "step" | "decision" | "component" | "node" | "item" | "mark" | "stage" | "event" | "span" | "branch";
export interface Element {
  id: string;
  zone: string;
  type: ElementType;
  label: string;
  icon?: string;
  /** Service icon prefixed with its catalog (`aws:lambda`). Independent of `icon`. */
  service?: string;
  comp?: ComponentType;
  after?: string;
  parent?: string;
  column?: "left" | "right";
  /** mark: position on the bar (0-100), explanation and tone. event: optional at. span: at = start, to = end. */
  at?: number;
  to?: number;
  /** event: date or label next to the mark. */
  when?: string;
  note?: string;
  tone?: MarkTone;
}
export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
  both: boolean;
}
export interface Emphasis { target: string; style: EmphasisStyle }
export interface Question { target: string; text?: string }
export interface Callout { id: string; target: string; text: string }

export interface Board {
  zones: Zone[];
  els: Element[];
  conns: Connection[];
  emph: Emphasis[];
  questions: Question[];
  callouts: Callout[];
  summary: string;
  zoneCounter: number;
}

export const emptyBoard = (): Board => ({
  zones: [], els: [], conns: [], emph: [], questions: [], callouts: [], summary: "", zoneCounter: 0,
});

export interface ApplyResult { board: Board; warnings: string[] }

const ELEMENT_ZONE: Record<ElementType, ZoneKind[]> = {
  step: ["flow"], decision: ["flow"], component: ["system"], node: ["mindmap"], item: ["list", "compare"], mark: ["scale"], stage: ["cycle"], event: ["timeline"], span: ["timeline"], branch: ["tree"],
};

export const findZone = (b: Board, id: string) => b.zones.find((z) => z.id === id);
export const findElement = (b: Board, id: string) => b.els.find((e) => e.id === id);
export const idTaken = (b: Board, id: string) =>
  !!findZone(b, id) || !!findElement(b, id) || b.conns.some((c) => c.id === id) || b.callouts.some((c) => c.id === id);
const isTarget = (b: Board, id: string) => !!findZone(b, id) || !!findElement(b, id) || b.conns.some((c) => c.id === id);

/** Implicit connections (after / parent) as regular connections with id "auto:<element>". */
export function derivedConnections(b: Board): Connection[] {
  const out: Connection[] = [];
  for (const e of b.els) {
    if (e.type === "stage") continue; // the cycle order is not an arrow: the ring draws it
    const from = e.type === "node" ? e.parent : e.after;
    if (from && findElement(b, from)) out.push({ id: `auto:${e.id}`, from, to: e.id, style: "solid", both: false });
  }
  return out;
}

function clone(b: Board): Board {
  return JSON.parse(JSON.stringify(b));
}

function removeRefs(b: Board, ids: Set<string>) {
  b.conns = b.conns.filter((c) => !ids.has(c.from) && !ids.has(c.to) && !ids.has(c.id));
  b.emph = b.emph.filter((e) => !ids.has(e.target));
  b.questions = b.questions.filter((q) => !ids.has(q.target));
  b.callouts = b.callouts.filter((c) => !ids.has(c.target) && !ids.has(c.id));
}

function str(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Known service id (`lambda` or `aws:lambda`) -> stored value (`aws:lambda`); null if unknown. */
export function parseService(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const id = v.trim().replace(new RegExp(`^${AWS_CATALOG_ID}:`), "");
  return AWS_SERVICES.some((s) => s.id === id) ? `${AWS_CATALOG_ID}:${id}` : null;
}

function inRange(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

export function applyOp(board: Board, op: Op): ApplyResult {
  const warnings: string[] = [];
  const bad = (msg: string): ApplyResult => ({ board, warnings: [`${op?.name ?? "?"}: ${msg}`] });
  if (!op || typeof op !== "object" || !op.input || typeof op.input !== "object") return bad("malformed operation");
  const b = clone(board);
  const i = op.input as unknown as Record<string, any>;

  const needNew = (v: unknown) => {
    if (!str(v)) return "missing id";
    if (idTaken(b, v)) return `id '${v}' already exists`;
    return null;
  };

  switch (op.name) {
    case "create_zone": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!ZONE_KINDS.includes(i.kind)) return bad("invalid kind");
      if (!str(i.title)) return bad("missing title");
      let place: Zone["place"];
      if (i.place) {
        if (!["right_of", "below"].includes(i.place.relation) || !findZone(b, i.place.of))
          warnings.push(`create_zone: place ignored (unknown zone '${i.place?.of}')`);
        else place = { relation: i.place.relation, of: i.place.of };
      }
      b.zones.push({
        id: i.id, kind: i.kind, title: i.title, place, n: b.zoneCounter++,
        ...(i.kind === "compare" ? { leftTitle: i.left_title ?? "", rightTitle: i.right_title ?? "" } : {}),
        ...(i.kind === "cycle" && str(i.center_label) ? { centerLabel: i.center_label } : {}),
        ...(i.kind === "scale" ? { minLabel: str(i.min_label) ? i.min_label : "0%", maxLabel: str(i.max_label) ? i.max_label : "100%" } : {}),
      });
      return { board: b, warnings };
    }
    case "add_step":
    case "add_decision":
    case "add_component":
    case "add_node":
    case "add_item": {
      const type: ElementType = { add_step: "step", add_decision: "decision", add_component: "component", add_node: "node", add_item: "item" }[op.name] as ElementType;
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (!ELEMENT_ZONE[type].includes(zone.kind)) return bad(`cannot add ${type} to a ${zone.kind} zone`);
      const label = type === "decision" ? i.question : type === "item" ? i.text : i.label;
      if (!str(label)) return bad("missing text");
      const el: Element = { id: i.id, zone: zone.id, type, label };
      if (type === "component") {
        if (!["actor", "client", "service", "database", "queue", "storage", "external"].includes(i.type)) return bad("invalid component type");
        el.comp = i.type;
      }
      const svc = type === "step" || type === "decision" || type === "component" ? parseService(i.service) : null;
      if (str(i.service) && (type === "step" || type === "decision" || type === "component") && !svc) {
        warnings.push(`${op.name}: unknown service '${i.service}'; ignored`);
      }
      if (svc) el.service = svc;
      // with a valid service the emoji is ignored
      if (str(i.icon) && !svc && (type === "step" || type === "component")) el.icon = i.icon;
      if (type === "step" || type === "decision") {
        if (i.after !== undefined) {
          const prev = findElement(b, i.after);
          if (!prev || prev.zone !== zone.id) warnings.push(`${op.name}: after '${i.after}' is not in the zone; ignored`);
          else el.after = prev.id;
        }
      }
      if (type === "node" && i.parent !== undefined) {
        const p = findElement(b, i.parent);
        if (!p || p.zone !== zone.id) warnings.push(`add_node: parent '${i.parent}' is not in the zone; ignored`);
        else el.parent = p.id;
      }
      if (type === "item" && zone.kind === "compare") el.column = i.column === "right" ? "right" : "left";
      b.els.push(el);
      return { board: b, warnings };
    }
    case "add_branch": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "tree") return bad(`cannot add branch to a ${zone.kind} zone`);
      if (!str(i.label)) return bad("missing label");
      const el: Element = { id: i.id, zone: zone.id, type: "branch", label: i.label, ...(str(i.note) ? { note: i.note } : {}) };
      if (i.parent !== undefined) {
        const p = findElement(b, i.parent);
        if (!p || p.zone !== zone.id || p.type !== "branch") warnings.push(`add_branch: parent '${i.parent}' is not a node of the zone; becomes a root`);
        else el.parent = p.id;
      }
      b.els.push(el);
      return { board: b, warnings };
    }
    case "add_mark": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "scale") return bad(`cannot add mark to a ${zone.kind} zone`);
      if (!inRange(i.at)) return bad("at must be a number between 0 and 100");
      if (!str(i.label)) return bad("missing label");
      if (i.tone !== undefined && !MARK_TONES.includes(i.tone)) return bad("invalid tone");
      b.els.push({
        id: i.id, zone: zone.id, type: "mark", label: i.label, at: i.at,
        ...(str(i.note) ? { note: i.note } : {}), tone: i.tone ?? "neutral",
      });
      return { board: b, warnings };
    }
    case "add_stage": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "cycle") return bad(`cannot add stage to a ${zone.kind} zone`);
      if (!str(i.label)) return bad("missing label");
      const el: Element = { id: i.id, zone: zone.id, type: "stage", label: i.label, ...(str(i.note) ? { note: i.note } : {}) };
      if (i.after !== undefined) {
        const prev = findElement(b, i.after);
        if (!prev || prev.zone !== zone.id || prev.type !== "stage") warnings.push(`add_stage: after '${i.after}' is not a stage of the zone; ignored`);
        else el.after = prev.id;
      }
      b.els.push(el);
      return { board: b, warnings };
    }
    case "add_event": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "timeline") return bad(`cannot add event to a ${zone.kind} zone`);
      if (!str(i.label)) return bad("missing label");
      if (i.at !== undefined && !inRange(i.at)) return bad("at must be a number between 0 and 100");
      b.els.push({
        id: i.id, zone: zone.id, type: "event", label: i.label,
        ...(str(i.when) ? { when: i.when } : {}), ...(str(i.note) ? { note: i.note } : {}),
        ...(i.at !== undefined ? { at: i.at } : {}),
      });
      return { board: b, warnings };
    }
    case "add_span": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "timeline") return bad(`cannot add span to a ${zone.kind} zone`);
      if (!inRange(i.from) || !inRange(i.to)) return bad("from and to must be numbers between 0 and 100");
      if (!(i.from < i.to)) return bad("from must be less than to");
      if (!str(i.label)) return bad("missing label");
      if (i.tone !== undefined && !MARK_TONES.includes(i.tone)) return bad("invalid tone");
      b.els.push({ id: i.id, zone: zone.id, type: "span", label: i.label, at: i.from, to: i.to, tone: i.tone ?? "neutral" });
      return { board: b, warnings };
    }
    case "set_level": {
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "scale") return bad(`set_level only works on a scale zone, not ${zone.kind}`);
      if (!inRange(i.at)) return bad("at must be a number between 0 and 100");
      zone.level = { at: i.at, ...(str(i.label) ? { label: i.label } : {}) };
      return { board: b, warnings };
    }
    case "connect": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!findElement(b, i.from)) return bad(`source '${i.from}' does not exist`);
      if (!findElement(b, i.to)) return bad(`target '${i.to}' does not exist`);
      if (i.from === i.to) return bad("source and target are the same");
      b.conns.push({
        id: i.id, from: i.from, to: i.to, label: str(i.label) ? i.label : undefined,
        style: i.style === "dashed" ? "dashed" : "solid", both: !!i.both_ways,
      });
      return { board: b, warnings };
    }
    case "emphasize": {
      if (!isTarget(b, i.target)) return bad(`target '${i.target}' does not exist`);
      if (!["circle", "underline", "star"].includes(i.style)) return bad("invalid style");
      b.emph = b.emph.filter((x) => x.target !== i.target);
      b.emph.push({ target: i.target, style: i.style });
      return { board: b, warnings };
    }
    case "mark_question": {
      if (!isTarget(b, i.target)) return bad(`target '${i.target}' does not exist`);
      b.questions = b.questions.filter((x) => x.target !== i.target);
      b.questions.push({ target: i.target, text: str(i.text) ? i.text : undefined });
      return { board: b, warnings };
    }
    case "add_callout": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!isTarget(b, i.target)) return bad(`target '${i.target}' does not exist`);
      if (!str(i.text)) return bad("missing text");
      b.callouts.push({ id: i.id, target: i.target, text: i.text });
      return { board: b, warnings };
    }
    case "update_label": {
      if (!str(i.label)) return bad("missing label");
      const z = findZone(b, i.id);
      if (z) { z.title = i.label; return { board: b, warnings }; }
      const el = findElement(b, i.id);
      if (el) { el.label = i.label; return { board: b, warnings }; }
      const c = b.conns.find((x) => x.id === i.id);
      if (c) { c.label = i.label; return { board: b, warnings }; }
      const co = b.callouts.find((x) => x.id === i.id);
      if (co) { co.text = i.label; return { board: b, warnings }; }
      return bad(`id '${i.id}' does not exist`);
    }
    case "set_service": {
      if (typeof i.service !== "string") return bad("missing service");
      const el = findElement(b, i.id);
      if (!el) return bad(findZone(b, i.id) ? `'${i.id}' is a zone; set_service only works on elements` : `id '${i.id}' does not exist`);
      if (!i.service.trim()) { delete el.service; return { board: b, warnings }; }
      const svc = parseService(i.service);
      if (!svc) return bad(`unknown service '${i.service}'; ignored`);
      // the `icon` emoji (if any) stays: the text doesn't change, so no redraw
      el.service = svc;
      return { board: b, warnings };
    }
    case "update_text": {
      if (typeof i.value !== "string") return bad("missing value");
      if (!TEXT_FIELDS.includes(i.field)) return bad(`invalid field '${i.field}'`);
      const empty = !i.value.trim();
      const missing = () => bad(`'${i.id}' has no ${i.field}`);
      const required = () => bad(`${i.field} of '${i.id}' cannot be left empty; use delete to remove the element`);
      const z = findZone(b, i.id);
      const el = findElement(b, i.id);
      const c = b.conns.find((x) => x.id === i.id);
      const co = b.callouts.find((x) => x.id === i.id);
      if (!z && !el && !c && !co) return bad(`id '${i.id}' does not exist`);
      switch (i.field) {
        case "label":
          if (z || el) {
            if (empty) return required();
            if (z) z.title = i.value; else el!.label = i.value;
          } else if (c) c.label = empty ? undefined : i.value;
          else return missing();
          break;
        case "note":
          if (!el || !["mark", "stage", "event", "branch"].includes(el.type)) return missing();
          el.note = empty ? undefined : i.value;
          break;
        case "when":
          if (!el || el.type !== "event") return missing();
          el.when = empty ? undefined : i.value;
          break;
        case "text":
          if (!co) return missing();
          if (empty) return required();
          co.text = i.value;
          break;
      }
      return { board: b, warnings };
    }
    case "delete": {
      const gone = new Set<string>();
      if (findZone(b, i.id)) {
        gone.add(i.id);
        for (const e of b.els) if (e.zone === i.id) gone.add(e.id);
        b.zones = b.zones.filter((z) => z.id !== i.id);
        b.els = b.els.filter((e) => e.zone !== i.id);
        // other zones that were placed relative to this one lose their hint
        for (const z of b.zones) if (z.place?.of === i.id) z.place = undefined;
      } else if (findElement(b, i.id)) {
        const el = findElement(b, i.id)!;
        gone.add(i.id);
        b.els = b.els.filter((e) => e.id !== i.id);
        for (const e of b.els) {
          if (e.after === i.id) e.after = undefined;
          if (e.parent === i.id) e.parent = el.parent; // children move up a level
        }
      } else if (b.conns.some((c) => c.id === i.id) || b.callouts.some((c) => c.id === i.id)) {
        gone.add(i.id);
      } else return bad(`id '${i.id}' does not exist`);
      removeRefs(b, gone);
      return { board: b, warnings };
    }
    case "move_to_zone": {
      const el = findElement(b, i.id);
      if (!el) return bad(`element '${i.id}' does not exist`);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (!ELEMENT_ZONE[el.type].includes(zone.kind)) return bad(`a ${el.type} does not fit in a ${zone.kind} zone`);
      if (el.zone === zone.id) return bad("already in that zone");
      el.zone = zone.id;
      el.after = undefined;
      el.parent = undefined;
      for (const o of b.els) {
        if (o.after === el.id && o.zone !== zone.id) o.after = undefined;
        if (o.parent === el.id && o.zone !== zone.id) o.parent = undefined;
      }
      if (zone.kind === "compare" && !el.column) el.column = "left";
      return { board: b, warnings };
    }
    case "update_summary": {
      if (!str(i.text)) return bad("missing text");
      b.summary = i.text;
      return { board: b, warnings };
    }
    default:
      return bad(`unknown operation '${(op as { name: string }).name}'`);
  }
}

export function applyOps(board: Board, ops: Op[]): ApplyResult {
  let b = board;
  const warnings: string[] = [];
  for (const o of ops) {
    const r = applyOp(b, o);
    b = r.board;
    warnings.push(...r.warnings);
  }
  return { board: b, warnings };
}
