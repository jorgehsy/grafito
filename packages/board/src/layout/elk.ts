import ELK from "elkjs/lib/elk.bundled.js";
import type { Connection, Element, Zone } from "../model";
import { placeLabel } from "./edges";
import { elementSize, emphasisRect, labelRect, overlaps, union } from "./geometry";
import type { Pt, Rect, ZoneLocal } from "./types";

const elk = new ELK();

async function layoutElk(zone: Zone, elements: Element[], connections: Connection[], extraObs: Rect[], dir: "RIGHT" | "DOWN" = "RIGHT"): Promise<ZoneLocal> {
  const sizes = Object.fromEntries(elements.map((e) => [e.id, elementSize(e)]));
  const hasLabels = connections.some((c) => c.label);
  const graph = {
    id: "root",
    layoutOptions: {
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
    },
    children: elements.map((e) => ({ id: e.id, width: sizes[e.id].w, height: sizes[e.id].h })),
    edges: connections.map((c) => {
      if (!c.label) return { id: c.id, sources: [c.from], targets: [c.to] };
      const r = labelRect({ x: 0, y: 0, text: c.label });
      return { id: c.id, sources: [c.from], targets: [c.to], labels: [{ id: `${c.id}:l`, text: c.label, width: r.w, height: r.h }] };
    }),
  };
  const res: any = await elk.layout(graph as any);
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {}, dir };
  for (const ch of res.children) out.elements[ch.id] = { x: ch.x, y: ch.y, w: ch.width, h: ch.height };
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
  const obs = [...Object.values(out.elements), ...extraObs.map((r) => ({ ...r }))];
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
  return union([...Object.values(z.elements), ...Object.values(z.connections).flatMap((g) => (g.label ? [labelRect(g.label)] : []))]);
}
const aspectMiss = (r: Rect) => Math.abs(Math.log(r.w / Math.max(1, r.h) / TARGET_ASPECT));

/** Left→right unless it ends up too wide and top→bottom makes better use of the available height. */
async function layoutElkBest(zone: Zone, elements: Element[], connections: Connection[], extraObs: Rect[], dir?: "RIGHT" | "DOWN"): Promise<ZoneLocal> {
  if (dir) return layoutElk(zone, elements, connections, extraObs, dir);
  const right = await layoutElk(zone, elements, connections, extraObs, "RIGHT");
  const rb = contentBox(right);
  if (rb.w <= MAX_RIGHT_W) return right;
  const down = await layoutElk(zone, elements, connections, extraObs, "DOWN");
  return aspectMiss(contentBox(down)) < aspectMiss(rb) ? down : right;
}

/** The emphasis circle depends on the final position: computed with a first ELK pass. */
export async function layoutElkWithEmph(zone: Zone, elements: Element[], connections: Connection[], circled: string[]): Promise<ZoneLocal> {
  const first = await layoutElkBest(zone, elements, connections, []);
  if (!circled.length) return first;
  const extra = circled.flatMap((id) => (first.elements[id] ? [emphasisRect(first.elements[id])] : []));
  // same direction as the first pass, so the emphasis gap lands where it belongs
  const dir = first.dir;
  return layoutElkBest(zone, elements, connections, extra, dir);
}
