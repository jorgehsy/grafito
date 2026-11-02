import ELK from "elkjs/lib/elk.bundled.js";
import type { Connection, Element, Group, Zone } from "../model";
import { placeLabel } from "./edges";
import { GROUP_HEAD, GROUP_PAD, elementSize, emphasisRect, groupHeaderRect, groupMinSize, labelRect, overlaps, union } from "./geometry";
import type { Pt, Rect, ZoneLocal } from "./types";

const elk = new ELK();

/**
 * Options ELK must not get on a group (a compound node): with either of them on a nested graph, elkjs 0.12
 * crashes inside layered ("Cannot read properties of undefined"). Set on the root only, they work.
 */
const ROOT_ONLY = ["elk.layered.considerModelOrder.strategy", "elk.layered.cycleBreaking.strategy"];

// Groups (architect mode) make the system zone a compound graph laid out in one run (INCLUDE_CHILDREN), so a
// group's box comes from its children and arrows cross group borders. What we found about the existing options:
// - NETWORK_SIMPLEX node placement works inside groups, also at several levels.
// - separateConnectedComponents is ignored at every level once INCLUDE_CHILDREN is on (componentComponent spacing
//   never shows): unconnected parts share the layers like one graph. That is why a grouped zone always tries both
//   directions and keeps the one closer to the target aspect (layoutElkBest).
// - The two model-order options crash when set on a group (ROOT_ONLY); on the root they still order the run.
// - A group's minimum size is applied transposed when the direction is DOWN (handled where the node is built).
// Coordinates come back in the root's frame (elk.json.shapeCoords/edgeCoords = ROOT), so nothing is re-offset.
// A zone without groups keeps the flat graph and options it always had.
export async function layoutElk(zone: Zone, elements: Element[], connections: Connection[], extraObs: Rect[], dir: "RIGHT" | "DOWN" = "RIGHT", groups: Group[] = []): Promise<ZoneLocal> {
  const sizes = Object.fromEntries(elements.map((e) => [e.id, elementSize(e)]));
  const hasLabels = connections.some((c) => c.label);
  const options: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.direction": dir,
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.spacing.nodeNode": "46",
    "elk.layered.spacing.nodeNodeBetweenLayers": hasLabels ? "120" : "70",
    "elk.layered.spacing.edgeNodeBetweenLayers": "26",
    "elk.spacing.edgeEdge": "18",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
    "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.componentComponent": "50",
    // ELK reserves room for each label so they don't land on top of the boxes
    "elk.edgeLabels.placement": "CENTER",
    "elk.spacing.edgeLabel": "6",
  };
  const compound = groups.length > 0;
  const known = new Set(groups.map((g) => g.id));
  const inside = (parent: string | undefined) => (parent && known.has(parent) ? parent : undefined);
  const groupOptions = {
    ...Object.fromEntries(Object.entries(options).filter(([k]) => !ROOT_ONLY.includes(k))),
    "elk.padding": `[top=${GROUP_HEAD + 12},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]`,
    "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
  };
  type ElkNode = { id: string; width: number; height: number; layoutOptions?: Record<string, string>; children?: ElkNode[] };
  const nodes = (parent: string | undefined): ElkNode[] => [
    ...elements.filter((e) => inside(e.group) === parent).map((e) => ({ id: e.id, width: sizes[e.id].w, height: sizes[e.id].h })),
    ...groups.filter((g) => inside(g.parent) === parent).map((g) => {
      const min = groupMinSize(g);
      const children = nodes(g.id);
      // an empty group is a plain node of its minimum size; one with content grows from it. ELK applies a
      // compound node's minimum in its rotated frame when the direction is DOWN, so it is given swapped there.
      const [mw, mh] = children.length && dir === "DOWN" ? [min.h, min.w] : [min.w, min.h];
      return { id: g.id, width: min.w, height: min.h, layoutOptions: { ...groupOptions, "elk.nodeSize.minimum": `(${mw}, ${mh})` }, children };
    }),
  ];
  const graph = {
    id: "root",
    layoutOptions: compound ? { ...options, "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.json.shapeCoords": "ROOT", "elk.json.edgeCoords": "ROOT" } : options,
    children: compound ? nodes(undefined) : elements.map((e) => ({ id: e.id, width: sizes[e.id].w, height: sizes[e.id].h })),
    edges: connections.map((c) => {
      if (!c.label) return { id: c.id, sources: [c.from], targets: [c.to] };
      const r = labelRect({ x: 0, y: 0, text: c.label });
      return { id: c.id, sources: [c.from], targets: [c.to], labels: [{ id: `${c.id}:l`, text: c.label, width: r.w, height: r.h }] };
    }),
  };
  const res: any = await elk.layout(graph as any);
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {}, dir, ...(compound ? { groups: {} } : {}) };
  type Placed = { id: string; x: number; y: number; width: number; height: number; children?: Placed[] };
  const read = (list: Placed[]) => {
    for (const ch of list) {
      const r = { x: ch.x, y: ch.y, w: ch.width, h: ch.height };
      if (known.has(ch.id)) { out.groups![ch.id] = r; read(ch.children ?? []); }
      else out.elements[ch.id] = r;
    }
  };
  read(res.children);
  for (const e of res.edges ?? []) {
    const s = e.sections?.[0];
    if (!s) continue;
    const pts: Pt[] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: Pt) => ({ x: p.x, y: p.y }));
    out.connections[e.id] = { kind: "poly", pts };
  }
  const elkLabel = new Map<string, Pt>();
  for (const e of res.edges ?? []) {
    const l = e.labels?.[0];
    if (l && l.x !== undefined) elkLabel.set(e.id, { x: l.x + l.width / 2, y: l.y + l.height / 2 });
  }
  const heads = groups.flatMap((g) => (out.groups?.[g.id] ? [groupHeaderRect(out.groups[g.id], g.label)] : []));
  const obs = [...Object.values(out.elements), ...heads, ...extraObs.map((r) => ({ ...r }))];
  const taken: Rect[] = [];
  const free = (r: Rect) => !obs.some((o) => overlaps(r, o, 2)) && !taken.some((o) => overlaps(r, o, 4));
  for (const c of connections) {
    const g = out.connections[c.id];
    if (!g || !c.label) continue;
    const at = elkLabel.get(c.id);
    const m = at && free(labelRect({ ...at, text: c.label })) ? at : placeLabel(g, c.label, obs, taken);
    g.label = { x: m.x, y: m.y, text: c.label };
    taken.push(labelRect(g.label));
  }
  return out;
}

/** Width/height ratio we aim for: that of a landscape screen. */
const TARGET_ASPECT = 1.6;
/** Below this width, left→right is always fine (it reads better). */
const MAX_RIGHT_W = 1000;
function contentBox(z: ZoneLocal): Rect {
  return union([...Object.values(z.elements), ...Object.values(z.groups ?? {}), ...Object.values(z.connections).flatMap((g) => (g.label ? [labelRect(g.label)] : []))]);
}
const aspectMiss = (r: Rect) => Math.abs(Math.log(r.w / Math.max(1, r.h) / TARGET_ASPECT));

/** Left→right unless it ends up too wide and top→bottom makes better use of the available height. */
/** With groups both directions are always tried: components cannot be packed apart (see layoutElk). */
async function layoutElkBest(zone: Zone, elements: Element[], connections: Connection[], extraObs: Rect[], dir: "RIGHT" | "DOWN" | undefined, groups: Group[]): Promise<ZoneLocal> {
  if (dir) return layoutElk(zone, elements, connections, extraObs, dir, groups);
  const right = await layoutElk(zone, elements, connections, extraObs, "RIGHT", groups);
  const rb = contentBox(right);
  if (rb.w <= MAX_RIGHT_W && !groups.length) return right;
  const down = await layoutElk(zone, elements, connections, extraObs, "DOWN", groups);
  return aspectMiss(contentBox(down)) < aspectMiss(rb) ? down : right;
}

/** The emphasis circle depends on the final position: computed with a first ELK pass. */
export async function layoutElkWithEmph(zone: Zone, elements: Element[], connections: Connection[], circled: string[], groups: Group[] = []): Promise<ZoneLocal> {
  const first = await layoutElkBest(zone, elements, connections, [], undefined, groups);
  if (!circled.length) return first;
  const extra = circled.flatMap((id) => (first.elements[id] ? [emphasisRect(first.elements[id])] : []));
  // same direction as the first pass, so the emphasis gap lands where it belongs
  const dir = first.dir;
  return layoutElkBest(zone, elements, connections, extra, dir, groups);
}
