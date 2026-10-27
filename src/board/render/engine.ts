// Motor de dibujo imperativo sobre SVG: animación de trazo, lápiz, resaltado, tweens y cámara.
// React sólo monta el <svg>; aquí vive todo lo que se mueve.
import type { Executor } from "../animator";
import type { Sink } from "../controller";
import type { Rect } from "../layout";
import { IDLE_OVERVIEW_MS, stepCam, targetCam, viewBoxOf, zoomAt } from "../camera";
import type { Cam, View } from "../camera";
import { geomEqual } from "../tree";
import type { Geom, RItem, RenderTree } from "../tree";
import { emptyTree } from "../tree";
import { addServiceIcon, enterSello, hideSello, planEntrada, removeSello } from "./sello";
import { buildVisual, hideForDraw, hideText, measure, RED, showAll } from "./visuals";
import type { Visual } from "./visuals";

const NS = "http://www.w3.org/2000/svg";
class Cancel extends Error {}

interface Shown {
  item: RItem;
  geom: Geom;
  vis: Visual;
  layer: SVGGElement;
  busy: boolean;
  tween?: { from: Geom; to: Geom; t0: number; dur: number };
}
interface Anim { t0: number; dur: number; fn: (p: number) => void; resolve: () => void; reject: (e: Error) => void }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function matchPoints(a: { x: number; y: number }[], b: { x: number; y: number }[]) {
  const split = (p: { x: number; y: number }[]) => {
    let best = 0, bi = 0;
    for (let i = 1; i < p.length; i++) {
      const l = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
      if (l > best) { best = l; bi = i; }
    }
    const m = { x: (p[bi].x + p[bi - 1].x) / 2, y: (p[bi].y + p[bi - 1].y) / 2 };
    return [...p.slice(0, bi), m, ...p.slice(bi)];
  };
  let pa = a, pb = b;
  while (pa.length < pb.length) pa = split(pa);
  while (pb.length < pa.length) pb = split(pb);
  return [pa, pb];
}

function lerpGeom(a: Geom, b: Geom, t: number): Geom {
  const g: Geom = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), curve: b.curve };
  if (a.lab && b.lab) g.lab = { x: lerp(a.lab.x, b.lab.x, t), y: lerp(a.lab.y, b.lab.y, t) };
  else g.lab = b.lab;
  if (a.pts && b.pts) {
    const [pa, pb] = a.curve && b.curve ? [a.pts, b.pts] : matchPoints(a.pts, b.pts);
    g.pts = pa.map((p, i) => ({ x: lerp(p.x, pb[i].x, t), y: lerp(p.y, pb[i].y, t) }));
  }
  return g;
}

export class Engine implements Sink, Executor {
  userSpeed = 1;
  paused = false;
  follow = true;
  onFollowChange?: (f: boolean) => void;

  private layers: Record<"zone" | "under" | "edge" | "element" | "ann", SVGGElement>;
  private pen: SVGGElement;
  private clock = 0;
  private lastReal = 0;
  private anims: Anim[] = [];
  private shown = new Map<string, Shown>();
  private target: RenderTree = emptyTree();
  private bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private focus: Rect | null = null;
  private cam: Cam = { cx: 0, cy: 0, scale: 1 };
  private camInit = false;
  private view: View = { w: 800, h: 600 };
  private manualUntil = 0;
  private lastActive = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];

  constructor(private svg: SVGSVGElement) {
    const mk = () => { const g = document.createElementNS(NS, "g"); svg.appendChild(g); return g; };
    this.layers = { zone: mk(), under: mk(), edge: mk(), element: mk(), ann: mk() };
    this.pen = this.makePen();
    svg.appendChild(this.pen);
    this.ro = new ResizeObserver(() => this.measureView());
    this.ro.observe(svg);
    this.measureView();
    this.bindInput();
    this.lastReal = performance.now();
    this.lastActive = this.lastReal;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cleanup.forEach((f) => f());
  }

  // ---------- Sink / Executor ----------
  setTarget(tree: RenderTree, bounds: Rect) {
    this.target = tree;
    this.bounds = bounds;
  }
  move() { /* los movimientos se resuelven en el bucle: compara lo mostrado con el objetivo */ }

  async draw(key: string, speed: number) {
    const t = this.target.map.get(key);
    if (!t || this.shown.has(key)) return;
    const vis = buildVisual(t, t.geom);
    const layer = this.layerOf(t);
    layer.appendChild(vis.g);
    measure(vis);
    const s: Shown = { item: t, geom: t.geom, vis, layer, busy: true };
    this.shown.set(key, s);
    this.highlight(s);
    this.setFocus(t.geom);
    this.lastActive = performance.now();
    if (!isFinite(speed)) { showAll(vis); s.busy = false; return; }
    const sp = speed * this.userSpeed;
    hideForDraw(vis);
    hideSello(vis);
    for (const { fase } of planEntrada("dibujar", !!vis.sello?.length, sp)) {
      if (fase === "trazo") await this.drawStrokes(s, sp);
      else if (fase === "relleno") {
        await this.frame(240 / sp, (p) => {
          for (const f of vis.fills) f.style.opacity = String(p * parseFloat(f.getAttribute("opacity") ?? "1"));
        });
        for (const f of vis.fills) f.style.opacity = "";
      } else if (fase === "sello") await enterSello(vis, (d, fn) => this.frame(d, fn), sp);
      else await this.writeText(s, sp);
    }
    this.hidePen();
    s.busy = false;
  }

  async update(key: string, speed: number) {
    const s = this.shown.get(key);
    const t = this.target.map.get(key);
    if (!s || !t) return;
    s.busy = true;
    this.setFocus(s.geom);
    const instant = !isFinite(speed);
    const sp = speed * this.userSpeed;
    if (!instant) await this.strike(s, sp);
    const vis = buildVisual(t, s.geom);
    const nuevo = vis.sello?.length && t.data.service !== s.item.data.service;
    s.layer.replaceChild(vis.g, s.vis.g);
    s.vis = vis;
    s.item = { ...t, geom: s.geom };
    this.highlight(s);
    if (!instant) {
      hideText(vis);
      if (nuevo) hideSello(vis);
      await this.writeText(s, sp);
      if (nuevo) await enterSello(vis, (d, fn) => this.frame(d, fn), sp);
      this.hidePen();
    }
    s.busy = false;
  }

  async remove(keys: string[], speed: number) {
    const list = keys.map((k) => this.shown.get(k)).filter((x): x is Shown => !!x);
    for (const s of list) { s.busy = true; s.tween = undefined; }
    if (isFinite(speed) && list.length) {
      const sp = speed * this.userSpeed;
      await this.frame(300 / sp, (p) => {
        for (const s of list) {
          s.vis.g.style.opacity = String(1 - p);
          if (s.vis.translates) {
            const k = 1 - 0.35 * p, cx = s.geom.w / 2, cy = s.geom.h / 2;
            s.vis.g.setAttribute("transform", `translate(${s.geom.x + cx * (1 - k)} ${s.geom.y + cy * (1 - k)}) scale(${k})`);
          }
        }
      });
    }
    for (const [k, s] of [...this.shown]) if (list.includes(s)) { s.vis.g.remove(); this.shown.delete(k); }
  }

  reset() {
    for (const a of this.anims.splice(0)) a.reject(new Cancel());
    for (const l of Object.values(this.layers)) l.replaceChildren();
    this.shown.clear();
    this.target = emptyTree();
    this.bounds = { x: 0, y: 0, w: 0, h: 0 };
    this.focus = null;
    this.camInit = false;
    this.lastActive = performance.now();
    this.hidePen();
  }

  setPaused(p: boolean) { this.paused = p; }
  setFollow(f: boolean) {
    this.follow = f;
    if (f) this.manualUntil = 0;
    this.onFollowChange?.(f);
  }
  get camScale() { return this.cam.scale; }

  // ---------- animación ----------
  private frame(dur: number, fn: (p: number) => void): Promise<void> {
    if (!(dur > 0) || !isFinite(dur)) { fn(1); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      this.anims.push({ t0: this.clock, dur, fn, resolve, reject });
      fn(0);
    });
  }

  private tick(now: number) {
    const dt = Math.min(100, now - this.lastReal);
    this.lastReal = now;
    if (!this.paused) {
      this.clock += dt;
      for (const a of [...this.anims]) {
        const p = Math.min(1, (this.clock - a.t0) / a.dur);
        a.fn(p);
        if (p >= 1) { this.anims.splice(this.anims.indexOf(a), 1); a.resolve(); }
      }
      this.syncGeometry();
    }
    this.updateCamera(dt, now);
  }

  private syncGeometry() {
    for (const [key, s] of this.shown) {
      const t = this.target.map.get(key);
      if (!t || s.busy) continue;
      if ((s.item.data.service ?? "") !== (t.data.service ?? "")) { void this.restamp(s, t); continue; }
      const differs = !geomEqual(s.geom, t.geom) || s.item.hue !== t.hue;
      if (s.tween && !geomEqual(s.tween.to, t.geom)) s.tween = differs ? { from: s.geom, to: t.geom, t0: this.clock, dur: 450 / this.userSpeed } : undefined;
      else if (!s.tween && differs) {
        const snap = !!s.geom.pts && !!t.geom.pts && s.geom.curve !== t.geom.curve;
        if (snap) this.applyGeom(s, t.geom, t.hue);
        else s.tween = { from: s.geom, to: t.geom, t0: this.clock, dur: Math.max(1, 450 / this.userSpeed) };
      }
      if (s.tween) {
        const p = Math.min(1, (this.clock - s.tween.t0) / s.tween.dur);
        const done = p >= 1;
        this.applyGeom(s, done ? s.tween.to : lerpGeom(s.tween.from, s.tween.to, ease(p)), done ? t.hue : s.item.hue);
        if (done) s.tween = undefined;
      } else if (s.item.hue !== t.hue) this.applyGeom(s, s.geom, t.hue);
    }
  }

  /** set_service sobre algo ya dibujado: no se tacha ni se redibuja; el sello salta encima (o se quita). */
  private async restamp(s: Shown, t: RItem) {
    s.busy = true;
    removeSello(s.vis);
    s.item = { ...s.item, data: { ...s.item.data, service: t.data.service } };
    addServiceIcon(s.vis, s.item, s.geom);
    const conSello = !!s.vis.sello?.length;
    const speed = Number.isFinite(this.userSpeed) ? this.userSpeed : 1;
    try {
      for (const { fase } of planEntrada("set_service", conSello, speed)) {
        if (fase === "sello") { hideSello(s.vis); await enterSello(s.vis, (d, fn) => this.frame(d, fn), speed); }
      }
    } catch { /* cancelado: el sello queda como esté */ }
    s.busy = false;
  }

  private applyGeom(s: Shown, g: Geom, hue: number) {
    const sameSize = Math.abs(g.w - s.geom.w) < 0.01 && Math.abs(g.h - s.geom.h) < 0.01 && !g.pts;
    if (s.vis.translates && sameSize && hue === s.item.hue) {
      s.vis.g.setAttribute("transform", `translate(${g.x} ${g.y})`);
    } else {
      const item: RItem = { ...s.item, hue, geom: g };
      const vis = buildVisual(item, g);
      showAll(vis);
      s.layer.replaceChild(vis.g, s.vis.g);
      s.vis = vis;
      s.item = item;
    }
    s.geom = g;
    s.item = { ...s.item, geom: g, hue };
  }

  // ---------- dibujo ----------
  private async drawStrokes(s: Shown, sp: number) {
    const total = s.vis.strokes.reduce((a, b) => a + b.len, 0);
    const rate = Math.max(1.5, total / 2400) * sp; // px por ms
    const ox = s.vis.translates ? s.geom.x : 0, oy = s.vis.translates ? s.geom.y : 0;
    this.showPen();
    for (const st of s.vis.strokes) {
      const len = st.len + 1;
      await this.frame(Math.max(50 / sp, st.len / rate), (p) => {
        st.anim.style.strokeDashoffset = String(len * (1 - p));
        const pt = st.anim.getPointAtLength(Math.min(st.len, st.len * p));
        this.movePen(pt.x + ox, pt.y + oy);
      });
      st.anim.style.strokeDashoffset = "0";
    }
  }

  private async writeText(s: Shown, sp: number) {
    const runs = s.vis.texts;
    const total = runs.reduce((a, r) => a + r.chars.length, 0);
    if (!total) return;
    const ox = s.vis.translates ? s.geom.x : 0, oy = s.vis.translates ? s.geom.y : 0;
    this.showPen();
    const flat: { run: (typeof runs)[number]; i: number }[] = [];
    for (const run of runs) run.chars.forEach((_, i) => flat.push({ run, i }));
    const dur = Math.min(1700, Math.max(250, total * 32)) / sp;
    let shown = 0;
    await this.frame(dur, (p) => {
      const n = Math.ceil(p * total);
      for (; shown < n; shown++) flat[shown].run.chars[flat[shown].i].removeAttribute("fill-opacity");
      const cur = flat[Math.max(0, Math.min(total - 1, n - 1))];
      try {
        const pt = cur.run.el.getStartPositionOfChar(cur.run.offsets[cur.i]);
        this.movePen(pt.x + ox + 6, pt.y + oy + 6);
      } catch { /* sin medida todavía */ }
    });
    flat.forEach((f) => f.run.chars[f.i].removeAttribute("fill-opacity"));
  }

  private async strike(s: Shown, sp: number) {
    const lines: SVGPathElement[] = [];
    for (const run of s.vis.texts) {
      const b = run.el.getBBox();
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M${b.x - 4} ${b.y + b.height / 2 + 2} L${b.x + b.width + 4} ${b.y + b.height / 2 - 2}`);
      p.setAttribute("stroke", RED); p.setAttribute("stroke-width", "3"); p.setAttribute("stroke-linecap", "round");
      s.vis.g.appendChild(p);
      lines.push(p);
    }
    await this.frame(380 / sp, (t) => {
      lines.forEach((l) => { const len = l.getTotalLength(); l.style.strokeDasharray = String(len); l.style.strokeDashoffset = String(len * (1 - t)); });
    });
    await this.frame(300 / sp, () => {});
  }

  private highlight(s: Shown) {
    const g = s.vis.g;
    let node: SVGElement;
    const kind = s.item.kind;
    if (kind === "edge" && s.vis.strokes[0]) {
      node = document.createElementNS(NS, "path");
      node.setAttribute("d", s.vis.strokes[0].anim.getAttribute("d")!);
      node.setAttribute("fill", "none"); node.setAttribute("stroke", "#ffe066"); node.setAttribute("stroke-width", "16"); node.setAttribute("stroke-linecap", "round");
    } else {
      const r = document.createElementNS(NS, "rect");
      const gm = s.geom;
      const local = s.vis.translates;
      const w = kind === "zone" ? Math.min(gm.w, (s.item.data.title?.length ?? 4) * 14 + 56) : gm.w;
      const h = kind === "zone" ? 52 : gm.h;
      r.setAttribute("x", String((local ? 0 : gm.x) - 8)); r.setAttribute("y", String((local ? 0 : gm.y) - 8));
      r.setAttribute("width", String(w + 16)); r.setAttribute("height", String(h + 16)); r.setAttribute("rx", "16");
      r.setAttribute("fill", "#ffe066");
      node = r;
    }
    node.style.opacity = "0.7";
    node.style.filter = "blur(5px)";
    node.style.pointerEvents = "none";
    g.insertBefore(node, g.firstChild);
    const a = node.animate([{ opacity: 0.75 }, { opacity: 0.75, offset: 0.25 }, { opacity: 0 }], { duration: 3200, fill: "forwards" });
    a.onfinish = () => node.remove();
  }

  // ---------- lápiz ----------
  private makePen(): SVGGElement {
    const g = document.createElementNS(NS, "g");
    g.style.display = "none";
    g.style.pointerEvents = "none";
    g.innerHTML = `<path d="M0 0 L3 -9 L21 -27 L27 -21 L9 -3 Z" fill="#ffd43b" stroke="#2b2f36" stroke-width="1.5" stroke-linejoin="round"/><path d="M0 0 L3 -9 L9 -3 Z" fill="#2b2f36"/><path d="M21 -27 L27 -21 L31 -25 L25 -31 Z" fill="#fa5252" stroke="#2b2f36" stroke-width="1.5"/>`;
    return g;
  }
  private penPos = { x: 0, y: 0 };
  private showPen() { this.pen.style.display = ""; }
  private hidePen() { this.pen.style.display = "none"; }
  private movePen(x: number, y: number) {
    this.penPos = { x, y };
    const k = Math.min(3, Math.max(1, 1 / this.cam.scale));
    this.pen.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  }

  // ---------- cámara ----------
  private layerOf(i: RItem) {
    if (i.under) return this.layers.under;
    return i.kind === "zone" ? this.layers.zone : i.kind === "edge" ? this.layers.edge : i.kind === "element" ? this.layers.element : this.layers.ann;
  }
  private setFocus(g: Geom) {
    this.focus = { x: g.x, y: g.y, w: Math.max(g.w, 60), h: Math.max(g.h, 40) };
  }
  private measureView() {
    const r = this.svg.getBoundingClientRect();
    this.view = { w: Math.max(100, r.width), h: Math.max(100, r.height) };
    this.applyViewBox();
  }
  private updateCamera(dt: number, nowReal: number) {
    const auto = this.follow && nowReal >= this.manualUntil;
    if (this.anims.length || [...this.shown.values()].some((s) => s.busy)) this.lastActive = nowReal;
    if (auto && this.bounds.w > 0) {
      const idle = nowReal - this.lastActive > IDLE_OVERVIEW_MS;
      const tgt = targetCam(this.focus, this.bounds, this.view, idle);
      this.cam = this.camInit ? stepCam(this.cam, tgt, dt) : tgt;
      this.camInit = true;
    } else if (!this.camInit) {
      this.cam = targetCam(null, this.bounds.w ? this.bounds : { x: 0, y: 0, w: this.view.w, h: this.view.h }, this.view);
    }
    this.applyViewBox();
  }
  private applyViewBox() {
    const [x, y, w, h] = viewBoxOf(this.cam, this.view);
    this.svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  }
  private manual() { this.manualUntil = performance.now() + 5000; this.camInit = true; }

  private bindInput() {
    const svg = this.svg;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.cam = zoomAt(this.cam, this.view, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      this.manual();
    };
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; svg.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      this.cam = { ...this.cam, cx: this.cam.cx - (e.clientX - drag.x) / this.cam.scale, cy: this.cam.cy - (e.clientY - drag.y) / this.cam.scale };
      drag = { x: e.clientX, y: e.clientY };
      this.manual();
    };
    const up = () => { drag = null; };
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    this.cleanup.push(() => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", down);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
    });
  }
}
