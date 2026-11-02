// Pure board model. No React, no coordinates.
import { qualifyService } from "@grafito/icons";
import type { ComponentType, EmphasisStyle, GroupKind, MarkTone, Op, ZoneKind } from "@grafito/contract";
import { ARCHITECT_ZONE_ID } from "./architect";

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
  /** component: id of the group it sits in (architect mode). */
  group?: string;
  /** Id of the open proposal it was drawn under: pencil. None = ink. */
  proposal?: string;
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
/** An AWS group (architect mode): a box in a system zone holding components and other groups. */
export interface Group {
  id: string;
  zone: string;
  kind: GroupKind;
  label: string;
  /** Id of the group it sits in; none = the top of the zone. */
  parent?: string;
  /** Id of the open proposal it was drawn under: pencil. None = ink. */
  proposal?: string;
}
export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed";
  both: boolean;
  /** Id of the open proposal it was drawn under: pencil. None = ink. */
  proposal?: string;
}
/**
 * Something Claude adds on its own initiative (architect mode), drawn in pencil until the user keeps it (accept:
 * ink) or turns it down (reject: erased). Only open proposals are kept; what was drawn under one carries its id.
 */
export interface Proposal {
  id: string;
  label: string;
  /** The open proposal this one is the other choice to; the two are drawn side by side and only one is kept. */
  alternativeTo?: string;
}
export interface Emphasis { target: string; style: EmphasisStyle }
export interface Question { target: string; text?: string }
export interface Callout { id: string; target: string; text: string }

export interface Board {
  zones: Zone[];
  elements: Element[];
  /** Groups as a flat list; `parent` makes the tree. */
  groups: Group[];
  connections: Connection[];
  emphasis: Emphasis[];
  questions: Question[];
  callouts: Callout[];
  /** Open proposals, in the order they were opened. */
  proposals: Proposal[];
  summary: string;
  zoneCounter: number;
}

export const emptyBoard = (): Board => ({
  zones: [], elements: [], groups: [], connections: [], emphasis: [], questions: [], callouts: [], proposals: [], summary: "", zoneCounter: 0,
});

export interface ApplyResult { board: Board; warnings: string[] }

const ELEMENT_ZONE: Record<ElementType, ZoneKind[]> = {
  step: ["flow"], decision: ["flow"], component: ["system"], node: ["mindmap"], item: ["list", "compare"], mark: ["scale"], stage: ["cycle"], event: ["timeline"], span: ["timeline"], branch: ["tree"],
};

export const findZone = (b: Board, id: string) => b.zones.find((z) => z.id === id);
export const findElement = (b: Board, id: string) => b.elements.find((e) => e.id === id);
export const findGroup = (b: Board, id: string) => b.groups.find((g) => g.id === id);
export const findProposal = (b: Board, id: string) => b.proposals.find((p) => p.id === id);
export const idTaken = (b: Board, id: string) =>
  !!findZone(b, id) || !!findElement(b, id) || !!findGroup(b, id) || b.connections.some((c) => c.id === id) || b.callouts.some((c) => c.id === id) || !!findProposal(b, id);
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

/** The zone a top-level group goes in: the architect zone, else the first system zone. */
function groupZone(b: Board): Zone | undefined {
  const system = b.zones.filter((z) => z.kind === "system");
  return system.find((z) => z.id === ARCHITECT_ZONE_ID) ?? system[0];
}

/** True if `id` is `group` or one of the groups inside it. */
function isInside(b: Board, id: string, group: string): boolean {
  for (let g: string | undefined = id, n = 0; g && n <= b.groups.length; n++) {
    if (g === group) return true;
    g = findGroup(b, g)?.parent;
  }
  return false;
}

/** At most this many proposals are alternatives of each other. */
export const MAX_ALTERNATIVES = 2;

/**
 * The open proposals that are alternatives of each other with `id` (linked by alternativeTo either way, also
 * through another one), `id` included, in the order they were opened. [] if `id` is not open.
 */
export function alternativesOf(b: Board, id: string): string[] {
  if (!findProposal(b, id)) return [];
  const set = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of b.proposals) {
      const linked = set.has(p.id) ? p.alternativeTo : p.alternativeTo && set.has(p.alternativeTo) ? p.id : undefined;
      if (linked && findProposal(b, linked) && !set.has(linked)) { set.add(linked); grew = true; }
    }
  }
  return b.proposals.filter((p) => set.has(p.id)).map((p) => p.id);
}

/** The open proposals in order, each with its alternatives (itself included; [] when it has none). */
export function openProposals(b: Board): { id: string; label: string; alternatives: string[] }[] {
  return b.proposals.map((p) => {
    const set = alternativesOf(b, p.id);
    return { id: p.id, label: p.label, alternatives: set.length > 1 ? set : [] };
  });
}

/** Erases everything drawn under these proposals. Ink inside an erased group moves up to the group's own parent. */
function eraseProposals(b: Board, ids: Set<string>) {
  if (!ids.size) return;
  const under = (x: { proposal?: string }) => !!x.proposal && ids.has(x.proposal);
  const goneGroups = new Map(b.groups.filter(under).map((g) => [g.id, g]));
  const lift = (g: string | undefined) => {
    for (let n = 0; g && goneGroups.has(g) && n <= b.groups.length; n++) g = goneGroups.get(g)!.parent;
    return g;
  };
  const gone = new Set<string>([...goneGroups.keys()]);
  for (const e of b.elements) if (under(e)) gone.add(e.id);
  for (const c of b.connections) if (under(c)) gone.add(c.id);
  b.groups = b.groups.filter((g) => !goneGroups.has(g.id));
  b.elements = b.elements.filter((e) => !gone.has(e.id));
  for (const g of b.groups) if (g.parent && goneGroups.has(g.parent)) { const up = lift(g.parent); if (up) g.parent = up; else delete g.parent; }
  for (const e of b.elements) {
    if (e.group && goneGroups.has(e.group)) { const up = lift(e.group); if (up) e.group = up; else delete e.group; }
    if (e.after && gone.has(e.after)) e.after = undefined;
    if (e.parent && gone.has(e.parent)) e.parent = undefined;
  }
  removeRefs(b, gone);
}

/** Closes these proposals; an open one that was their alternative stands on its own. */
function closeProposals(b: Board, ids: Set<string>) {
  b.proposals = b.proposals.filter((p) => !ids.has(p.id));
  for (const p of b.proposals) if (p.alternativeTo && ids.has(p.alternativeTo)) delete p.alternativeTo;
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
  return qualifyService(v.trim());
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
  // A drawing op under a proposal that is not open is not drawn: ink means the user agreed, so it is never the fallback.
  const notOpen = i.proposal !== undefined && !findProposal(b, i.proposal) ? `proposal '${i.proposal}' is not open; not drawn` : null;
  const proposal: { proposal?: string } = i.proposal !== undefined ? { proposal: i.proposal } : {};

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
      const e = needNew(i.id) ?? notOpen;
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
      if (type === "component" && i.parent !== undefined) {
        const g = findGroup(b, i.parent);
        if (!g || g.zone !== zone.id) warnings.push(`add_component: parent '${i.parent}' is not a group of the zone; ignored`);
        else element.group = g.id;
      }
      Object.assign(element, proposal);
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
      const e = needNew(i.id) ?? notOpen;
      if (e) return bad(e);
      for (const end of [i.from, i.to]) if (findGroup(b, end)) return bad(`'${end}' is a group; arrows join components only`);
      if (!findElement(b, i.from)) return bad(`source '${i.from}' does not exist`);
      if (!findElement(b, i.to)) return bad(`target '${i.to}' does not exist`);
      b.connections.push({
        id: i.id, from: i.from, to: i.to, label: str(i.label) ? i.label : undefined,
        style: i.style === "dashed" ? "dashed" : "solid", both: !!i.both_ways, ...proposal,
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
      const g = findGroup(b, i.id);
      if (g) { g.label = i.label; return { board: b, warnings }; }
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
        b.groups = b.groups.filter((g) => g.zone !== i.id);
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
      } else if (findGroup(b, i.id)) {
        // what was inside moves up to the group's own parent: nothing disappears unless it is named
        const up = findGroup(b, i.id)!.parent;
        gone.add(i.id);
        b.groups = b.groups.filter((g) => g.id !== i.id);
        for (const g of b.groups) if (g.parent === i.id) g.parent = up;
        for (const e of b.elements) if (e.group === i.id) e.group = up;
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
      element.group = undefined;
      element.after = undefined;
      element.parent = undefined;
      for (const o of b.elements) {
        if (o.after === element.id && o.zone !== zone.id) o.after = undefined;
        if (o.parent === element.id && o.zone !== zone.id) o.parent = undefined;
      }
      if (zone.kind === "compare" && !element.column) element.column = "left";
      return { board: b, warnings };
    }
    case "add_group": {
      const e = needNew(i.id) ?? notOpen;
      if (e) return bad(e);
      let parent: Group | undefined;
      if (i.parent !== undefined) {
        parent = findGroup(b, i.parent);
        if (!parent) warnings.push(`add_group: parent '${i.parent}' is not a group; drawn at the top of the zone`);
      }
      const zone = parent ? findZone(b, parent.zone) : groupZone(b);
      if (!zone) return bad("there is no system zone to draw the group in");
      b.groups.push({ id: i.id, zone: zone.id, kind: i.kind, label: i.label, ...(parent ? { parent: parent.id } : {}), ...proposal });
      return { board: b, warnings };
    }
    case "set_parent": {
      const g = findGroup(b, i.id);
      const element = g ? undefined : findElement(b, i.id);
      if (!g && !element) return bad(`id '${i.id}' does not exist`);
      if (element && element.type !== "component") return bad(`'${i.id}' is a ${element.type}; only components and groups go in a group`);
      const zoneId = g ? g.zone : element!.zone;
      if (i.parent === null) {
        if (g) delete g.parent; else delete element!.group;
        return { board: b, warnings };
      }
      const parent = findGroup(b, i.parent);
      if (!parent) return bad(`parent '${i.parent}' is not a group`);
      if (parent.zone !== zoneId) return bad(`group '${i.parent}' is in another zone`);
      if (g && isInside(b, parent.id, g.id)) return bad(`cannot put '${g.id}' inside itself or a group it contains`);
      if (g) g.parent = parent.id; else element!.group = parent.id;
      return { board: b, warnings };
    }
    case "propose": {
      const e = needNew(i.id);
      if (e) return bad(e);
      const p: Proposal = { id: i.id, label: i.label };
      const other = i.alternative_to;
      if (other !== undefined) {
        if (!findProposal(b, other)) warnings.push(`propose: '${other}' is not an open proposal; ${i.id} opens on its own`);
        else if (alternativesOf(b, other).length >= MAX_ALTERNATIVES) warnings.push(`propose: '${other}' already has an alternative (at most ${MAX_ALTERNATIVES} side by side); ${i.id} opens on its own`);
        else p.alternativeTo = other;
      }
      b.proposals.push(p);
      return { board: b, warnings };
    }
    case "accept":
    case "reject": {
      const id: string = i.proposal;
      if (!findProposal(b, id)) return bad(`proposal '${id}' is not open`);
      // accepting keeps this one in ink and erases its alternatives; rejecting erases only this one
      const erased = op.name === "accept" ? alternativesOf(b, id).filter((x) => x !== id) : [id];
      if (op.name === "accept") for (const x of [...b.elements, ...b.groups, ...b.connections]) if (x.proposal === id) delete x.proposal;
      eraseProposals(b, new Set(erased));
      closeProposals(b, new Set([id, ...erased]));
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
