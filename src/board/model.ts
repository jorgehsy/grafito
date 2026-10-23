// Modelo puro del tablero v2. Sin React, sin coordenadas.
import { MARK_TONES, TEXT_FIELDS, ZONE_KINDS } from "./ops";
import type { ComponentType, EmphasisStyle, MarkTone, Op, ZoneKind } from "./ops";

export interface Zone {
  id: string;
  kind: ZoneKind;
  title: string;
  leftTitle?: string;
  rightTitle?: string;
  /** scale: etiquetas de los extremos de la barra y nivel actual (relleno). */
  minLabel?: string;
  maxLabel?: string;
  level?: { at: number; label?: string };
  /** cycle: texto del centro. */
  centerLabel?: string;
  place?: { relation: "right_of" | "below"; of: string };
  /** Número de orden de creación (colorea la zona de forma estable). */
  n: number;
}
export type ElType = "step" | "decision" | "component" | "node" | "item" | "mark" | "stage" | "event" | "span" | "branch";
export interface El {
  id: string;
  zone: string;
  type: ElType;
  label: string;
  icon?: string;
  comp?: ComponentType;
  after?: string;
  parent?: string;
  column?: "left" | "right";
  /** mark: posición en la barra (0-100), explicación y tono. event: at opcional. span: at = inicio, to = final. */
  at?: number;
  to?: number;
  /** event: fecha o etiqueta junto a la marca. */
  when?: string;
  note?: string;
  tone?: MarkTone;
}
export interface Conn {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
  both: boolean;
}
export interface Emph { target: string; style: EmphasisStyle }
export interface Question { target: string; text?: string }
export interface Callout { id: string; target: string; text: string }

export interface Board {
  zones: Zone[];
  els: El[];
  conns: Conn[];
  emph: Emph[];
  questions: Question[];
  callouts: Callout[];
  summary: string;
  zoneCounter: number;
}

export const emptyBoard = (): Board => ({
  zones: [], els: [], conns: [], emph: [], questions: [], callouts: [], summary: "", zoneCounter: 0,
});

export interface ApplyResult { board: Board; warnings: string[] }

const ELEMENT_ZONE: Record<ElType, ZoneKind[]> = {
  step: ["flow"], decision: ["flow"], component: ["system"], node: ["mindmap"], item: ["list", "compare"], mark: ["scale"], stage: ["cycle"], event: ["timeline"], span: ["timeline"], branch: ["tree"],
};

export const findZone = (b: Board, id: string) => b.zones.find((z) => z.id === id);
export const findEl = (b: Board, id: string) => b.els.find((e) => e.id === id);
export const idTaken = (b: Board, id: string) =>
  !!findZone(b, id) || !!findEl(b, id) || b.conns.some((c) => c.id === id) || b.callouts.some((c) => c.id === id);
const isTarget = (b: Board, id: string) => !!findZone(b, id) || !!findEl(b, id) || b.conns.some((c) => c.id === id);

/** Conexiones implícitas (after / parent) como conexiones normales con id "auto:<elemento>". */
export function derivedConns(b: Board): Conn[] {
  const out: Conn[] = [];
  for (const e of b.els) {
    if (e.type === "stage") continue; // el orden del ciclo no es una flecha: lo dibuja el anillo
    const from = e.type === "node" ? e.parent : e.after;
    if (from && findEl(b, from)) out.push({ id: `auto:${e.id}`, from, to: e.id, style: "solid", both: false });
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

function inRange(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

export function applyOp(board: Board, op: Op): ApplyResult {
  const warnings: string[] = [];
  const bad = (msg: string): ApplyResult => ({ board, warnings: [`${op?.name ?? "?"}: ${msg}`] });
  if (!op || typeof op !== "object" || !op.input || typeof op.input !== "object") return bad("operación mal formada");
  const b = clone(board);
  const i = op.input as unknown as Record<string, any>;

  const needNew = (v: unknown) => {
    if (!str(v)) return "falta id";
    if (idTaken(b, v)) return `el id '${v}' ya existe`;
    return null;
  };

  switch (op.name) {
    case "create_zone": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!ZONE_KINDS.includes(i.kind)) return bad("kind inválido");
      if (!str(i.title)) return bad("falta title");
      let place: Zone["place"];
      if (i.place) {
        if (!["right_of", "below"].includes(i.place.relation) || !findZone(b, i.place.of))
          warnings.push(`create_zone: place ignorado (zona '${i.place?.of}' desconocida)`);
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
      const type: ElType = { add_step: "step", add_decision: "decision", add_component: "component", add_node: "node", add_item: "item" }[op.name] as ElType;
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (!ELEMENT_ZONE[type].includes(zone.kind)) return bad(`no se puede añadir ${type} a una zona ${zone.kind}`);
      const label = type === "decision" ? i.question : type === "item" ? i.text : i.label;
      if (!str(label)) return bad("falta texto");
      const el: El = { id: i.id, zone: zone.id, type, label };
      if (type === "component") {
        if (!["actor", "client", "service", "database", "queue", "storage", "external"].includes(i.type)) return bad("type de componente inválido");
        el.comp = i.type;
      }
      if (str(i.icon) && (type === "step" || type === "component")) el.icon = i.icon;
      if (type === "step" || type === "decision") {
        if (i.after !== undefined) {
          const prev = findEl(b, i.after);
          if (!prev || prev.zone !== zone.id) warnings.push(`${op.name}: after '${i.after}' no está en la zona; se ignora`);
          else el.after = prev.id;
        }
      }
      if (type === "node" && i.parent !== undefined) {
        const p = findEl(b, i.parent);
        if (!p || p.zone !== zone.id) warnings.push(`add_node: parent '${i.parent}' no está en la zona; se ignora`);
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
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (zone.kind !== "tree") return bad(`no se puede añadir branch a una zona ${zone.kind}`);
      if (!str(i.label)) return bad("falta label");
      const el: El = { id: i.id, zone: zone.id, type: "branch", label: i.label, ...(str(i.note) ? { note: i.note } : {}) };
      if (i.parent !== undefined) {
        const p = findEl(b, i.parent);
        if (!p || p.zone !== zone.id || p.type !== "branch") warnings.push(`add_branch: parent '${i.parent}' no es un nodo de la zona; queda como raíz`);
        else el.parent = p.id;
      }
      b.els.push(el);
      return { board: b, warnings };
    }
    case "add_mark": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (zone.kind !== "scale") return bad(`no se puede añadir mark a una zona ${zone.kind}`);
      if (!inRange(i.at)) return bad("at debe ser un número entre 0 y 100");
      if (!str(i.label)) return bad("falta label");
      if (i.tone !== undefined && !MARK_TONES.includes(i.tone)) return bad("tone inválido");
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
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (zone.kind !== "cycle") return bad(`no se puede añadir stage a una zona ${zone.kind}`);
      if (!str(i.label)) return bad("falta label");
      const el: El = { id: i.id, zone: zone.id, type: "stage", label: i.label, ...(str(i.note) ? { note: i.note } : {}) };
      if (i.after !== undefined) {
        const prev = findEl(b, i.after);
        if (!prev || prev.zone !== zone.id || prev.type !== "stage") warnings.push(`add_stage: after '${i.after}' no es una etapa de la zona; se ignora`);
        else el.after = prev.id;
      }
      b.els.push(el);
      return { board: b, warnings };
    }
    case "add_event": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (zone.kind !== "timeline") return bad(`no se puede añadir event a una zona ${zone.kind}`);
      if (!str(i.label)) return bad("falta label");
      if (i.at !== undefined && !inRange(i.at)) return bad("at debe ser un número entre 0 y 100");
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
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (zone.kind !== "timeline") return bad(`no se puede añadir span a una zona ${zone.kind}`);
      if (!inRange(i.from) || !inRange(i.to)) return bad("from y to deben ser números entre 0 y 100");
      if (!(i.from < i.to)) return bad("from debe ser menor que to");
      if (!str(i.label)) return bad("falta label");
      if (i.tone !== undefined && !MARK_TONES.includes(i.tone)) return bad("tone inválido");
      b.els.push({ id: i.id, zone: zone.id, type: "span", label: i.label, at: i.from, to: i.to, tone: i.tone ?? "neutral" });
      return { board: b, warnings };
    }
    case "set_level": {
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (zone.kind !== "scale") return bad(`set_level sólo vale para una zona scale, no ${zone.kind}`);
      if (!inRange(i.at)) return bad("at debe ser un número entre 0 y 100");
      zone.level = { at: i.at, ...(str(i.label) ? { label: i.label } : {}) };
      return { board: b, warnings };
    }
    case "connect": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!findEl(b, i.from)) return bad(`origen '${i.from}' no existe`);
      if (!findEl(b, i.to)) return bad(`destino '${i.to}' no existe`);
      if (i.from === i.to) return bad("origen y destino iguales");
      b.conns.push({
        id: i.id, from: i.from, to: i.to, label: str(i.label) ? i.label : undefined,
        style: i.style === "dashed" ? "dashed" : "solid", both: !!i.both_ways,
      });
      return { board: b, warnings };
    }
    case "emphasize": {
      if (!isTarget(b, i.target)) return bad(`objetivo '${i.target}' no existe`);
      if (!["circle", "underline", "star"].includes(i.style)) return bad("style inválido");
      b.emph = b.emph.filter((x) => x.target !== i.target);
      b.emph.push({ target: i.target, style: i.style });
      return { board: b, warnings };
    }
    case "mark_question": {
      if (!isTarget(b, i.target)) return bad(`objetivo '${i.target}' no existe`);
      b.questions = b.questions.filter((x) => x.target !== i.target);
      b.questions.push({ target: i.target, text: str(i.text) ? i.text : undefined });
      return { board: b, warnings };
    }
    case "add_callout": {
      const e = needNew(i.id);
      if (e) return bad(e);
      if (!isTarget(b, i.target)) return bad(`objetivo '${i.target}' no existe`);
      if (!str(i.text)) return bad("falta text");
      b.callouts.push({ id: i.id, target: i.target, text: i.text });
      return { board: b, warnings };
    }
    case "update_label": {
      if (!str(i.label)) return bad("falta label");
      const z = findZone(b, i.id);
      if (z) { z.title = i.label; return { board: b, warnings }; }
      const el = findEl(b, i.id);
      if (el) { el.label = i.label; return { board: b, warnings }; }
      const c = b.conns.find((x) => x.id === i.id);
      if (c) { c.label = i.label; return { board: b, warnings }; }
      const co = b.callouts.find((x) => x.id === i.id);
      if (co) { co.text = i.label; return { board: b, warnings }; }
      return bad(`id '${i.id}' no existe`);
    }
    case "update_text": {
      if (typeof i.value !== "string") return bad("falta value");
      if (!TEXT_FIELDS.includes(i.field)) return bad(`field inválido '${i.field}'`);
      const empty = !i.value.trim();
      const missing = () => bad(`'${i.id}' no tiene ${i.field}`);
      const required = () => bad(`${i.field} de '${i.id}' no puede quedar vacío; usa delete si quieres quitar el elemento`);
      const z = findZone(b, i.id);
      const el = findEl(b, i.id);
      const c = b.conns.find((x) => x.id === i.id);
      const co = b.callouts.find((x) => x.id === i.id);
      if (!z && !el && !c && !co) return bad(`id '${i.id}' no existe`);
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
        // otras zonas que se colocaban respecto a ésta pierden la pista
        for (const z of b.zones) if (z.place?.of === i.id) z.place = undefined;
      } else if (findEl(b, i.id)) {
        const el = findEl(b, i.id)!;
        gone.add(i.id);
        b.els = b.els.filter((e) => e.id !== i.id);
        for (const e of b.els) {
          if (e.after === i.id) e.after = undefined;
          if (e.parent === i.id) e.parent = el.parent; // los hijos suben un nivel
        }
      } else if (b.conns.some((c) => c.id === i.id) || b.callouts.some((c) => c.id === i.id)) {
        gone.add(i.id);
      } else return bad(`id '${i.id}' no existe`);
      removeRefs(b, gone);
      return { board: b, warnings };
    }
    case "move_to_zone": {
      const el = findEl(b, i.id);
      if (!el) return bad(`elemento '${i.id}' no existe`);
      const zone = findZone(b, i.zone);
      if (!zone) return bad(`zona '${i.zone}' no existe`);
      if (!ELEMENT_ZONE[el.type].includes(zone.kind)) return bad(`un ${el.type} no cabe en una zona ${zone.kind}`);
      if (el.zone === zone.id) return bad("ya está en esa zona");
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
      if (!str(i.text)) return bad("falta text");
      b.summary = i.text;
      return { board: b, warnings };
    }
    default:
      return bad(`operación desconocida '${(op as { name: string }).name}'`);
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
