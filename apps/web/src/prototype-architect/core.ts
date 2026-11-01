// THROWAWAY PROTOTYPE (#36): scripted state machine, no real engine.
export type Status = "none" | "pencil" | "ink" | "erased";
export type VariantId = "A" | "B" | "C";

export const STAGE = { w: 1000, h: 560 };

export interface El {
  id: string;
  grp: string;
  kind: "box" | "group";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
}
export interface Edge {
  id: string;
  grp: string;
  a: [number, number];
  b: [number, number];
}

export const ELEMENTS: El[] = [
  { id: "cf", grp: "sk1", kind: "box", x: 60, y: 60, w: 150, h: 60, label: "CloudFront" },
  { id: "s3", grp: "sk1", kind: "box", x: 60, y: 170, w: 150, h: 60, label: "S3", sub: "static site" },
  { id: "api", grp: "sk1", kind: "box", x: 330, y: 115, w: 150, h: 70, label: "API" },
  { id: "altA", grp: "altA", kind: "group", x: 530, y: 40, w: 210, h: 170, label: "A: ALB + ECS" },
  { id: "alb", grp: "altA", kind: "box", x: 550, y: 85, w: 170, h: 48, label: "ALB" },
  { id: "ecs", grp: "altA", kind: "box", x: 550, y: 150, w: 170, h: 48, label: "ECS Fargate" },
  { id: "altB", grp: "altB", kind: "group", x: 770, y: 40, w: 210, h: 170, label: "B: API GW + Lambda" },
  { id: "apigw", grp: "altB", kind: "box", x: 790, y: 85, w: 170, h: 48, label: "API Gateway" },
  { id: "lambda", grp: "altB", kind: "box", x: 790, y: 150, w: 170, h: 48, label: "Lambda" },
  { id: "vpc", grp: "db", kind: "group", x: 300, y: 340, w: 380, h: 180, label: "VPC" },
  { id: "rds", grp: "db", kind: "box", x: 330, y: 410, w: 140, h: 64, label: "RDS", sub: "single-AZ" },
  { id: "standby", grp: "standby", kind: "box", x: 500, y: 410, w: 150, h: 64, label: "RDS standby", sub: "AZ b" },
];

export const EDGES: Edge[] = [
  { id: "e1", grp: "sk1", a: [210, 90], b: [330, 150] },
  { id: "e2", grp: "sk1", a: [135, 120], b: [135, 170] },
  { id: "e3", grp: "altA", a: [635, 133], b: [635, 150] },
  { id: "e4", grp: "altB", a: [875, 133], b: [875, 150] },
  { id: "e5", grp: "standby", a: [470, 442], b: [500, 442] },
];

export interface BubbleDef {
  id: string;
  turn: number;
  kind: "speech" | "general";
  target?: { el: string } | { pt: [number, number] };
  x: number;
  y: number;
  w: number;
  text: string;
  hint: string;
  actions?: "approve" | "choose";
  /** marker anchor on the board for the click-first variant */
  dot: [number, number];
  /** row y for the margin icon of the text-first variant */
  row: number;
}

export const BUBBLES: BubbleDef[] = [
  { id: "b1", turn: 1, kind: "general", x: 690, y: 420, w: 270, text: "What does this app do, and how many users at peak?", hint: "just type your answer below", dot: [975, 535], row: 520 },
  { id: "b2", turn: 2, kind: "speech", target: { el: "api" }, x: 200, y: 222, w: 250, text: "Is the API stateful? If not, Lambda is cheaper. Approve this sketch?", hint: "say yes / no", actions: "approve", dot: [480, 115], row: 150 },
  { id: "b3", turn: 3, kind: "speech", target: { pt: [745, 214] }, x: 700, y: 250, w: 270, text: "A is simpler to run, B scales to zero. Which?", hint: "say A or B", actions: "choose", dot: [745, 214], row: 214 },
  { id: "b4", turn: 4, kind: "speech", target: { el: "rds" }, x: 24, y: 380, w: 250, text: "Single-AZ RDS fails Reliability. Add a standby in a second AZ?", hint: "say yes / no", actions: "approve", dot: [470, 410], row: 442 },
  { id: "b5", turn: 5, kind: "general", x: 690, y: 400, w: 270, text: "Static site, API and a resilient database are in place. Shall we cover auth and monitoring next?", hint: "press Reset to replay", dot: [945, 535], row: 490 },
];

export interface State {
  turn: number;
  status: Record<string, Status>;
  showPast: boolean;
  opened: string[];
  selected: string | null;
  nudge: number;
}

/** Groups drawn in pencil when a turn starts; also the groups waiting for a decision. */
export const PENDING: Record<number, string[]> = { 2: ["sk1"], 3: ["altA", "altB"], 4: ["db"] };

export const initial = (): State => ({ turn: 1, status: {}, showPast: false, opened: [], selected: null, nudge: 0 });

export type Action =
  | { t: "text"; text: string; parse: boolean }
  | { t: "approve" }
  | { t: "reject" }
  | { t: "choose"; which: "A" | "B" }
  | { t: "togglePast" }
  | { t: "toggleOpen"; id: string }
  | { t: "select"; grp: string | null }
  | { t: "reset" };

function advance(s: State, patch: Record<string, Status>): State {
  const turn = s.turn + 1;
  const status = { ...s.status, ...patch };
  for (const g of PENDING[turn] ?? []) status[g] = "pencil";
  return { ...s, turn, status, selected: null, opened: [] };
}

export function parseIntent(text: string): "yes" | "no" | "A" | "B" | null {
  const t = text.trim().toLowerCase();
  if (/^(a|option a|choose a|go with a)$|alb|ecs|simple/.test(t)) return "A";
  if (/^(b|option b|choose b|go with b)$|lambda|gateway|scale/.test(t)) return "B";
  if (/^(y|yes|yep|yeah|ok|okay|sure|approve|approved|si|sí|do it|add it|go)\b/.test(t)) return "yes";
  if (/^(n|no|nope|nah|reject|rejected|cancel|dont)\b/.test(t)) return "no";
  return null;
}

export function reduce(s: State, a: Action): State {
  switch (a.t) {
    case "reset":
      return initial();
    case "togglePast":
      return { ...s, showPast: !s.showPast, opened: [] };
    case "toggleOpen":
      return { ...s, opened: s.opened.includes(a.id) ? s.opened.filter((x) => x !== a.id) : [...s.opened, a.id] };
    case "select":
      return { ...s, selected: a.grp };
    case "approve":
      if (s.turn === 2) return advance(s, { sk1: "ink" });
      if (s.turn === 4) return advance(s, { db: "ink", standby: "ink" });
      return s;
    case "reject":
      if (s.turn === 2) return advance(s, { sk1: "erased" });
      if (s.turn === 4) return advance(s, { db: "erased" });
      return s;
    case "choose":
      if (s.turn !== 3) return s;
      return advance(s, a.which === "A" ? { altA: "ink", altB: "erased" } : { altA: "erased", altB: "ink" });
    case "text": {
      if (s.turn === 1) return a.text.trim() ? advance(s, {}) : s;
      if (s.turn >= 5) return s;
      const nudged = { ...s, nudge: s.nudge + 1 };
      if (!a.parse) return nudged;
      const i = parseIntent(a.text);
      if (s.turn === 3) return i === "A" || i === "B" ? reduce(s, { t: "choose", which: i }) : nudged;
      if (i === "yes") return reduce(s, { t: "approve" });
      if (i === "no") return reduce(s, { t: "reject" });
      return nudged;
    }
  }
}

export type BubbleState = "open" | "marker" | "hidden";
export function bubbleState(b: BubbleDef, s: State): BubbleState {
  if (b.turn > s.turn) return "hidden";
  if (b.turn === s.turn) return "open";
  return s.showPast || s.opened.includes(b.id) ? "open" : "marker";
}

export function bbox(grps: string[]) {
  const els = ELEMENTS.filter((e) => grps.includes(e.grp));
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y };
}

export function tipFor(b: BubbleDef, cx: number, cy: number): [number, number] {
  const t = b.target;
  if (!t) return [STAGE.w - 6, STAGE.h - 6];
  if ("pt" in t) return t.pt;
  const e = ELEMENTS.find((x) => x.id === t.el)!;
  const px = Math.min(Math.max(cx, e.x), e.x + e.w);
  const py = Math.min(Math.max(cy, e.y), e.y + e.h);
  const dx = cx - px;
  const dy = cy - py;
  const d = Math.hypot(dx, dy) || 1;
  return [px + (dx / d) * 6, py + (dy / d) * 6];
}

export const TURN_LABEL = ["", "1 intake", "2 sketch", "3 alternatives", "4 database", "5 wrap-up"];
