// Orthogonal routing for connections between zones: A* over a coarse grid.
// Elements are obstacles, zone interiors cost more than the corridors between them, and
// already-routed paths are penalized so parallel ones don't stack. Pure and deterministic.
import type { Pt, Rect } from "./layout";

const G = 12;
const TURN = 5;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export interface RouterInput {
  bounds: Rect;
  els: Rect[];
  zones: Rect[];
  /** zones that are "expensive" to cross (headers with the title) */
  headers: Rect[];
}

class Grid {
  cols: number; rows: number; ox: number; oy: number;
  blocked: Uint8Array;
  cost: Float32Array;
  constructor(inp: RouterInput, public margin: number, public used: Float32Array) {
    const pad = 170;
    this.ox = Math.floor((inp.bounds.x - pad) / G) * G;
    this.oy = Math.floor((inp.bounds.y - pad) / G) * G;
    this.cols = Math.ceil((inp.bounds.w + 2 * pad) / G) + 1;
    this.rows = Math.ceil((inp.bounds.h + 2 * pad) / G) + 1;
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.cost = new Float32Array(this.cols * this.rows).fill(1);
    for (const r of inp.els) {
      this.paint(r, margin, (c) => { this.blocked[c]++; });
      this.paint(r, 30, (c) => { this.cost[c] += 1.2; });
    }
    for (const r of inp.zones) this.paint(r, 0, (c) => { this.cost[c] += 2.5; });
    for (const r of inp.headers) this.paint(r, 0, (c) => { this.cost[c] += 25; });
  }
  paint(r: Rect, m: number, f: (c: number) => void) {
    const i0 = Math.max(0, Math.ceil((r.x - m - this.ox) / G)), i1 = Math.min(this.cols - 1, Math.floor((r.x + r.w + m - this.ox) / G));
    const j0 = Math.max(0, Math.ceil((r.y - m - this.oy) / G)), j1 = Math.min(this.rows - 1, Math.floor((r.y + r.h + m - this.oy) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * this.cols + i);
  }
}

interface Port { dir: number; anchor: Pt; extra: number }
function ports(r: Rect, out: number): Port[] {
  const res: Port[] = [];
  const slots = (len: number, thin: boolean) => (len >= 90 && !thin ? [[0.5, 0], [0.28, 2.5], [0.72, 2.5]] : [[0.5, 0]]);
  for (const [f, e] of slots(r.h, false)) {
    res.push({ dir: 0, anchor: { x: r.x + r.w + out, y: r.y + r.h * f }, extra: e });
    res.push({ dir: 2, anchor: { x: r.x - out, y: r.y + r.h * f }, extra: e });
  }
  for (const [f, e] of slots(r.w, false)) {
    res.push({ dir: 1, anchor: { x: r.x + r.w * f, y: r.y + r.h + out }, extra: e });
    res.push({ dir: 3, anchor: { x: r.x + r.w * f, y: r.y - out }, extra: e });
  }
  return res;
}

export class Router {
  private used: Float32Array;
  private grids: Grid[];
  constructor(private inp: RouterInput) {
    const probe = new Grid({ ...inp, els: [], zones: [], headers: [] }, 0, new Float32Array(0));
    this.used = new Float32Array(probe.cols * probe.rows);
    this.grids = [12, 6, 1].map((m) => new Grid(inp, m, this.used));
  }

  /** Orthogonal route from a to b (or null). Marks the path to penalize later overlaps. */
  route(a: Rect, b: Rect, startOut = 4, endOut = 6): Pt[] | null {
    for (const g of this.grids) {
      const r = this.run(g, a, b, startOut, endOut);
      if (r) { this.mark(g, r.cells); return r.pts; }
    }
    return null;
  }

  private mark(g: Grid, cells: number[]) {
    for (const c of cells) {
      this.used[c] += 8;
      const i = c % g.cols, j = (c - i) / g.cols;
      for (let d = 0; d < 4; d++) {
        const ni = i + DX[d], nj = j + DY[d];
        if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
        this.used[nj * g.cols + ni] += 3;
      }
    }
  }

  private run(g: Grid, a: Rect, b: Rect, so: number, eo: number): { pts: Pt[]; cells: number[] } | null {
    const { cols, rows, ox, oy } = g;
    const cellOf = (p: Pt) => ({ i: Math.round((p.x - ox) / G), j: Math.round((p.y - oy) / G) });
    // unblock the endpoints: inside the box stays blocked, around it does not
    const undo: (() => void)[] = [];
    for (const r of [a, b]) {
      g.paint(r, g.margin, (c) => { g.blocked[c]--; });
      g.paint(r, 2, (c) => { g.blocked[c]++; });
      undo.push(() => { g.paint(r, 2, (c) => { g.blocked[c]--; }); g.paint(r, g.margin, (c) => { g.blocked[c]++; }); });
    }
    try {
      const starts: { c: number; dir: number; g0: number; anchor: Pt }[] = [];
      for (const p of ports(a, so)) {
        const q = { x: p.anchor.x + DX[p.dir] * 14, y: p.anchor.y + DY[p.dir] * 14 };
        const { i, j } = cellOf(q);
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        const c = j * cols + i;
        if (g.blocked[c]) continue;
        starts.push({ c, dir: p.dir, g0: p.extra + g.used[c], anchor: p.anchor });
      }
      const goals = new Map<number, { anchor: Pt; extra: number; dir: number }>();
      for (const p of ports(b, eo)) {
        const q = { x: p.anchor.x + DX[p.dir] * 14, y: p.anchor.y + DY[p.dir] * 14 };
        const { i, j } = cellOf(q);
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        const c = j * cols + i;
        if (g.blocked[c]) continue;
        const inward = (p.dir + 2) % 4;
        const key = c * 4 + inward;
        const prev = goals.get(key);
        if (!prev || p.extra < prev.extra) goals.set(key, { anchor: p.anchor, extra: p.extra + g.used[c], dir: p.dir });
      }
      if (!starts.length || !goals.size) return null;
      const gl = [...goals.keys()].map((k) => { const c = k >> 2; return { i: c % cols, j: (c - (c % cols)) / cols }; });
      const h = (c: number) => {
        const i = c % cols, j = (c - i) / cols;
        let m = Infinity;
        for (const q of gl) m = Math.min(m, Math.abs(q.i - i) + Math.abs(q.j - j));
        return m;
      };
      const N = cols * rows * 4;
      const dist = new Float32Array(N).fill(Infinity);
      const parent = new Int32Array(N).fill(-1);
      const heap = new Heap();
      const startAnchor = new Map<number, Pt>();
      for (const s of starts) {
        const st = s.c * 4 + s.dir;
        if (s.g0 < dist[st]) { dist[st] = s.g0; startAnchor.set(st, s.anchor); heap.push(s.g0 + h(s.c), st); }
      }
      let found = -1, it = 0;
      while (heap.size && it++ < 600000) {
        const st = heap.pop();
        const c = st >> 2, dir = st & 3;
        const gc = dist[st];
        if (goals.has(st)) { found = st; break; }
        const ci = c % cols, cj = (c - ci) / cols;
        for (const nd of [dir, (dir + 1) % 4, (dir + 3) % 4]) {
          const ni = ci + DX[nd], nj = cj + DY[nd];
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nc = nj * cols + ni;
          if (g.blocked[nc]) continue;
          const ns = nc * 4 + nd;
          const ng = gc + g.cost[nc] + g.used[nc] + (nd !== dir ? TURN : 0);
          if (ng < dist[ns]) { dist[ns] = ng; parent[ns] = st; heap.push(ng + h(nc), ns); }
        }
      }
      if (found < 0) return null;
      const goal = goals.get(found)!;
      const chain: number[] = [];
      let cur = found;
      while (cur >= 0) { chain.push(cur); cur = parent[cur]; }
      chain.reverse();
      const cells = chain.map((s) => s >> 2);
      const sAnchor = startAnchor.get(chain[0])!;
      const dS = chain[0] & 3, dE = goal.dir;
      const pt = (c: number): Pt => ({ x: ox + (c % cols) * G, y: oy + ((c - (c % cols)) / cols) * G });
      // corners
      let corners: Pt[] = [];
      chain.forEach((s, k) => {
        const p = pt(s >> 2);
        if (k === 0 || k === chain.length - 1 || (s & 3) !== (chain[k + 1] & 3)) corners.push(p);
      });
      if (corners.length < 2) return null;
      const n = corners.length;
      if (n === 2) {
        corners = [];
        if (dS % 2 === 0) {
          if (Math.abs(sAnchor.y - goal.anchor.y) >= 0.5) { const mx = (sAnchor.x + goal.anchor.x) / 2; corners = [{ x: mx, y: sAnchor.y }, { x: mx, y: goal.anchor.y }]; }
        } else if (Math.abs(sAnchor.x - goal.anchor.x) >= 0.5) { const my = (sAnchor.y + goal.anchor.y) / 2; corners = [{ x: sAnchor.x, y: my }, { x: goal.anchor.x, y: my }]; }
      } else {
        const fix = (i0: number, i1: number, dir: number, a: Pt) => {
          const horiz = dir % 2 === 0;
          const c0 = corners[i0], c1 = corners[i1];
          const same = horiz ? c0.y === c1.y : c0.x === c1.x;
          corners[i0] = horiz ? { ...c0, y: a.y } : { ...c0, x: a.x };
          if (same) corners[i1] = horiz ? { ...c1, y: a.y } : { ...c1, x: a.x };
        };
        fix(0, 1, dS, sAnchor);
        fix(n - 1, n - 2, dE, goal.anchor);
      }
      const pts: Pt[] = [sAnchor, ...corners, goal.anchor];
      // drop duplicates and collinear points
      const out: Pt[] = [];
      for (const p of pts) {
        const l = out[out.length - 1];
        if (l && Math.abs(l.x - p.x) < 0.01 && Math.abs(l.y - p.y) < 0.01) continue;
        out.push(p);
        while (out.length >= 3) {
          const [x, y, z] = out.slice(-3);
          if ((Math.abs(x.x - y.x) < 0.01 && Math.abs(y.x - z.x) < 0.01) || (Math.abs(x.y - y.y) < 0.01 && Math.abs(y.y - z.y) < 0.01)) out.splice(out.length - 2, 1);
          else break;
        }
      }
      return { pts: out, cells };
    } finally {
      undo.forEach((f) => f());
    }
  }
}
