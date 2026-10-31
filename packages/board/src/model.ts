// Pure board model. No React, no coordinates.
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
  elements: Element[];
  connections: Connection[];
  emphasis: Emphasis[];
  questions: Question[];
  callouts: Callout[];
  summary: string;
  zoneCounter: number;
}

export const emptyBoard = (): Board => ({
  zones: [], elements: [], connections: [], emphasis: [], questions: [], callouts: [], summary: "", zoneCounter: 0,
});

export interface ApplyResult { board: Board; warnings: string[] }

const ELEMENT_ZONE: Record<ElementType, ZoneKind[]> = {
  step: ["flow"], decision: ["flow"], component: ["system"], node: ["mindmap"], item: ["list", "compare"], mark: ["scale"], stage: ["cycle"], event: ["timeline"], span: ["timeline"], branch: ["tree"],
};

export const findZone = (b: Board, id: string) => b.zones.find((z) => z.id === id);
export const findElement = (b: Board, id: string) => b.elements.find((e) => e.id === id);
export const idTaken = (b: Board, id: string) =>
  !!findZone(b, id) || !!findElement(b, id) || b.connections.some((c) => c.id === id) || b.callouts.some((c) => c.id === id);
const isTarget = (b: Board, id: string) => !!findZone(b, id) || !!findElement(b, id) || b.connections.some((c) => c.id === id);

/** Implicit connections (after / parent) as regular connections with id "auto:<element>". */
export function derivedConnections(b: Board): Connection[] {
  const out: Connection[] = [];
  for (const e of b.elements) {
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
  b.connections = b.connections.filter((c) => !ids.has(c.from) && !ids.has(c.to) && !ids.has(c.id));
  b.emphasis = b.emphasis.filter((e) => !ids.has(e.target));
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

/**
 * Applies one op. The op's shape is the contract's job (parseOp in @grafito/contract);
 * here only the checks that need the board: ids that exist or are taken, zones of the right kind.
 */
export function applyOp(board: Board, op: Op): ApplyResult {
  const warnings: string[] = [];
  const bad = (msg: string): ApplyResult => ({ board, warnings: [`${op.name}: ${msg}`] });
  const b = clone(board);
  const i = op.input as unknown as Record<string, any>;

  const needNew = (v: string) => (idTaken(b, v) ? `id '${v}' already exists` : null);

  switch (op.name) {
    case "create_zone": {
      const e = needNew(i.id);
      if (e) return bad(e);
      let place: Zone["place"];
      if (i.place) {
        if (!findZone(b, i.place.of))
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
      const element: Element = { id: i.id, zone: zone.id, type, label };
      if (type === "component") element.comp = i.type;
      const svc = type === "step" || type === "decision" || type === "component" ? parseService(i.service) : null;
      if (str(i.service) && (type === "step" || type === "decision" || type === "component") && !svc) {
        warnings.push(`${op.name}: unknown service '${i.service}'; ignored`);
      }
      if (svc) element.service = svc;
      // with a valid service the emoji is ignored
      if (str(i.icon) && !svc && (type === "step" || type === "component")) element.icon = i.icon;
      if (type === "step" || type === "decision") {
        if (i.after !== undefined) {
          const prev = findElement(b, i.after);
          if (!prev || prev.zone !== zone.id) warnings.push(`${op.name}: after '${i.after}' is not in the zone; ignored`);
          else element.after = prev.id;
        }
      }
      if (type === "node" && i.parent !== undefined) {
        const p = findElement(b, i.parent);
        if (!p || p.zone !== zone.id) warnings.push(`add_node: parent '${i.parent}' is not in the zone; ignored`);
        else element.parent = p.id;
      }
      if (type === "item" && zone.kind === "compare") element.column = i.column === "right" ? "right" : "left";
      b.elements.push(element);
      return { board: b, warnings };
    }
    case "add_branch": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "tree") return bad(`cannot add branch to a ${zone.kind} zone`);
      const element: Element = { id: i.id, zone: zone.id, type: "branch", label: i.label, ...(str(i.note) ? { note: i.note } : {}) };
      if (i.parent !== undefined) {
        const p = findElement(b, i.parent);
        if (!p || p.zone !== zone.id || p.type !== "branch") warnings.push(`add_branch: parent '${i.parent}' is not a node of the zone; becomes a root`);
        else element.parent = p.id;
      }
      b.elements.push(element);
      return { board: b, warnings };
    }
    case "add_mark": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "scale") return bad(`cannot add mark to a ${zone.kind} zone`);
      b.elements.push({
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
      const element: Element = { id: i.id, zone: zone.id, type: "stage", label: i.label, ...(str(i.note) ? { note: i.note } : {}) };
      if (i.after !== undefined) {
        const prev = findElement(b, i.after);
        if (!prev || prev.zone !== zone.id || prev.type !== "stage") warnings.push(`add_stage: after '${i.after}' is not a stage of the zone; ignored`);
        else element.after = prev.id;
      }
      b.elements.push(element);
      return { board: b, warnings };
    }
    case "add_event": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "timeline") return bad(`cannot add event to a ${zone.kind} zone`);
      b.elements.push({
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
      b.elements.push({ id: i.id, zone: zone.id, type: "span", label: i.label, at: i.from, to: i.to, tone: i.tone ?? "neutral" });
      return { board: b, warnings };
    }
    case "set_level": {
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (zone.kind !== "scale") return bad(`set_level only works on a scale zone, not ${zone.kind}`);
      zone.level = { at: i.at, ...(str(i.label) ? { label: i.label } : {}) };
      return { board: b, warnings };
    }
    case "connect": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!findElement(b, i.from)) return bad(`source '${i.from}' does not exist`);
      if (!findElement(b, i.to)) return bad(`target '${i.to}' does not exist`);
      b.connections.push({
        id: i.id, from: i.from, to: i.to, label: str(i.label) ? i.label : undefined,
        style: i.style === "dashed" ? "dashed" : "solid", both: !!i.both_ways,
      });
      return { board: b, warnings };
    }
    case "emphasize": {
      if (!isTarget(b, i.target)) return bad(`target '${i.target}' does not exist`);
      b.emphasis = b.emphasis.filter((x) => x.target !== i.target);
      b.emphasis.push({ target: i.target, style: i.style });
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
      b.callouts.push({ id: i.id, target: i.target, text: i.text });
      return { board: b, warnings };
    }
    case "update_label": {
      const z = findZone(b, i.id);
      if (z) { z.title = i.label; return { board: b, warnings }; }
      const element = findElement(b, i.id);
      if (element) { element.label = i.label; return { board: b, warnings }; }
      const c = b.connections.find((x) => x.id === i.id);
      if (c) { c.label = i.label; return { board: b, warnings }; }
      const co = b.callouts.find((x) => x.id === i.id);
      if (co) { co.text = i.label; return { board: b, warnings }; }
      return bad(`id '${i.id}' does not exist`);
    }
    case "set_service": {
      const element = findElement(b, i.id);
      if (!element) return bad(findZone(b, i.id) ? `'${i.id}' is a zone; set_service only works on elements` : `id '${i.id}' does not exist`);
      if (!i.service.trim()) { delete element.service; return { board: b, warnings }; }
      const svc = parseService(i.service);
      if (!svc) return bad(`unknown service '${i.service}'; ignored`);
      // the `icon` emoji (if any) stays: the text doesn't change, so no redraw
      element.service = svc;
      return { board: b, warnings };
    }
    case "update_text": {
      const empty = !i.value.trim();
      const missing = () => bad(`'${i.id}' has no ${i.field}`);
      const required = () => bad(`${i.field} of '${i.id}' cannot be left empty; use delete to remove the element`);
      const z = findZone(b, i.id);
      const element = findElement(b, i.id);
      const c = b.connections.find((x) => x.id === i.id);
      const co = b.callouts.find((x) => x.id === i.id);
      if (!z && !element && !c && !co) return bad(`id '${i.id}' does not exist`);
      switch (i.field) {
        case "label":
          if (z || element) {
            if (empty) return required();
            if (z) z.title = i.value; else element!.label = i.value;
          } else if (c) c.label = empty ? undefined : i.value;
          else return missing();
          break;
        case "note":
          if (!element || !["mark", "stage", "event", "branch"].includes(element.type)) return missing();
          element.note = empty ? undefined : i.value;
          break;
        case "when":
          if (!element || element.type !== "event") return missing();
          element.when = empty ? undefined : i.value;
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
        for (const e of b.elements) if (e.zone === i.id) gone.add(e.id);
        b.zones = b.zones.filter((z) => z.id !== i.id);
        b.elements = b.elements.filter((e) => e.zone !== i.id);
        // other zones that were placed relative to this one lose their hint
        for (const z of b.zones) if (z.place?.of === i.id) z.place = undefined;
      } else if (findElement(b, i.id)) {
        const element = findElement(b, i.id)!;
        gone.add(i.id);
        b.elements = b.elements.filter((e) => e.id !== i.id);
        for (const e of b.elements) {
          if (e.after === i.id) e.after = undefined;
          if (e.parent === i.id) e.parent = element.parent; // children move up a level
        }
      } else if (b.connections.some((c) => c.id === i.id) || b.callouts.some((c) => c.id === i.id)) {
        gone.add(i.id);
      } else return bad(`id '${i.id}' does not exist`);
      removeRefs(b, gone);
      return { board: b, warnings };
    }
    case "move_to_zone": {
      const element = findElement(b, i.id);
      if (!element) return bad(`element '${i.id}' does not exist`);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zone '${i.zone}' does not exist`);
      if (!ELEMENT_ZONE[element.type].includes(zone.kind)) return bad(`a ${element.type} does not fit in a ${zone.kind} zone`);
      if (element.zone === zone.id) return bad("already in that zone");
      element.zone = zone.id;
      element.after = undefined;
      element.parent = undefined;
      for (const o of b.elements) {
        if (o.after === element.id && o.zone !== zone.id) o.after = undefined;
        if (o.parent === element.id && o.zone !== zone.id) o.parent = undefined;
      }
      if (zone.kind === "compare" && !element.column) element.column = "left";
      return { board: b, warnings };
    }
    case "update_summary": {
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
