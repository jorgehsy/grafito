// Imperative SVG engine: stroke animation, pen, highlight, tweens and camera. React only mounts the <svg>.
import type { Executor } from "@grafito/board";
import type { Sink } from "@grafito/board";
import type { Rect } from "@grafito/board";
import { IDLE_OVERVIEW_MS, stepCam, targetCam, viewBoxOf, zoomAt } from "@grafito/board";
import type { Cam, View } from "@grafito/board";
import { geomEqual } from "@grafito/board";
import type { Geom, RenderItem, RenderTree } from "@grafito/board";
import { emptyTree } from "@grafito/board";
import { addServiceIcon, enterStamp, hideStamp, entrancePlan, removeStamp } from "./stamp";
import { RED } from "@grafito/board";
import { buildVisual, hideForDraw, hideText, measure, showAll } from "./visuals";
import type { Visual } from "./visuals";
import { standaloneSvg } from "./svg-export";
import { hitStroke, simplifyStroke, sketchBounds, strokePath, INK } from "@grafito/board";
import type { Stroke } from "@grafito/board";
import type { SketchStore } from "../sketch/store";
import { svgToPng } from "../sketch/rasterize";
import { spacePan } from "./spacePan";

/** What a left-button drag on the board does: move the camera, draw ink, or rub ink out. */
export type Tool = "pan" | "pen" | "eraser";
/** Someone else's pointer, in board coordinates. */
export interface Cursor { id: string; name: string; color: string; x: number; y: number }

const STROKE_WIDTH = 3.2;
/** Eraser reach, in screen pixels. */
const ERASER_PX = 10;
/** After a stroke the camera stays where the hand left it for this long. */
const HOLD_AFTER_DRAW_MS = 8000;
/**
 * A finished stroke as it is stored: simplified, then with points put back along its long straight runs. The
 * path rounds every vertex toward the midpoints of its two segments, so a corner between two long runs would
 * otherwise turn into a wide curve and a hand-drawn box into a blob.
 */
function tidyStroke(pts: readonly number[], maxGap = 12): number[] {
  const simple = simplifyStroke(pts);
  const out: number[] = simple.slice(0, 2);
  for (let i = 2; i + 1 < simple.length; i += 2) {
    const ax = simple[i - 2], ay = simple[i - 1], bx = simple[i], by = simple[i + 1];
    const steps = Math.min(40, Math.ceil(Math.hypot(bx - ax, by - ay) / maxGap));
    for (let k = 1; k <= steps; k++) out.push(Math.round((ax + ((bx - ax) * k) / steps) * 10) / 10, Math.round((ay + ((by - ay) * k) / steps) * 10) / 10);
  }
  return out;
}
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

const NS = "http://www.w3.org/2000/svg";
class Cancel extends Error {}

interface Shown {
  item: RenderItem;
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
  /** A click (not a drag) on the board: the key of the pencil item under it, or null for ink or empty paper. */
  onPick?: (key: string | null) => void;
  /** The pointer over the board, in board coordinates; null when it leaves. */
  onPointer?: (at: { x: number; y: number } | null) => void;
  /** A pen stroke starts (true) or ends (false). */
  onDrawing?: (drawing: boolean) => void;
  /** Colour of the next pen stroke. */
  penColor: string = INK;
  /** Who draws here: the participant id stamped on each stroke. */
  author = "me";

  private layers: Record<"zone" | "group" | "under" | "connection" | "element" | "ann", SVGGElement>;
  private pen: SVGGElement;
  private sketchLayer: SVGGElement;
  private cursorLayer: SVGGElement;
  private currentTool: Tool = "pan";
  private sketch: SketchStore | null = null;
  private sketchOff: (() => void) | null = null;
  private inked = new Map<string, SVGPathElement>();
  private draftEls = new Map<string, SVGPathElement>();
  private reading = new Set<string>();
  private sketchBox: Rect | null = null;
  private drawing = false;
  private spaceHeld = false;
  private cursors = new Map<string, { g: SVGGElement; x: number; y: number; tx: number; ty: number }>();
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
  private selected = new Set<string>();

  constructor(private svg: SVGSVGElement) {
    const mk = () => { const g = document.createElementNS(NS, "g"); svg.appendChild(g); return g; };
    this.layers = { zone: mk(), group: mk(), under: mk(), connection: mk(), element: mk(), ann: mk() };
    this.sketchLayer = mk();
    this.sketchLayer.style.pointerEvents = "none";
    this.pen = this.makePen();
    svg.appendChild(this.pen);
    // other people's cursors: screen only (`data-hit` keeps the layer out of the exported SVG)
    this.cursorLayer = mk();
    this.cursorLayer.dataset.hit = "";
    this.cursorLayer.style.pointerEvents = "none";
    svg.dataset.tool = this.currentTool;
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
    this.sketchOff?.();
    this.cleanup.forEach((f) => f());
  }

  // ---- sketch: hand-drawn ink on top of the board ----

  get tool(): Tool { return this.currentTool; }
  setTool(tool: Tool) {
    this.currentTool = tool;
    this.svg.dataset.tool = tool;
  }

  /** The store whose strokes this engine draws, and where the pen and eraser write; null detaches it. */
  setSketch(store: SketchStore | null) {
    this.sketchOff?.();
    this.sketchOff = null;
    for (const el of [...this.inked.values(), ...this.draftEls.values()]) el.remove();
    this.inked.clear();
    this.draftEls.clear();
    this.sketch = store;
    this.sketchBox = null;
    if (!store) return;
    this.sketchOff = store.subscribe(() => this.renderSketch());
    this.renderSketch();
  }

  /** Marks the strokes Claude is reading right now (they pulse); [] clears it. */
  setReading(ids: readonly string[]) {
    this.reading = new Set(ids);
    for (const [id, el] of this.inked) { if (this.reading.has(id)) el.dataset.reading = ""; else delete el.dataset.reading; }
  }

  private strokeEl(s: Pick<Stroke, "color" | "pts">): SVGPathElement {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", strokePath(s.pts));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", s.color);
    p.setAttribute("stroke-width", String(STROKE_WIDTH));
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    return p;
  }

  private renderSketch() {
    const store = this.sketch;
    if (!store) return;
    const strokes = store.strokes();
    const ids = new Set(strokes.map((s) => s.id));
    for (const s of strokes) {
      if (this.inked.has(s.id)) continue;
      const el = this.strokeEl(s);
      el.dataset.stroke = s.id;
      if (this.reading.has(s.id)) el.dataset.reading = "";
      this.sketchLayer.appendChild(el);
      this.inked.set(s.id, el);
    }
    for (const [id, el] of [...this.inked]) {
      if (ids.has(id)) continue;
      this.inked.delete(id);
      delete el.dataset.reading;
      // the ink fades instead of vanishing: this is the moment it is taken
      const fade = typeof el.animate === "function" ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out" }) : null;
      if (fade) { fade.onfinish = () => el.remove(); fade.oncancel = () => el.remove(); } else el.remove();
    }
    // strokes other people are still drawing
    const drafts = store.drafts();
    const live = new Set(drafts.map((s) => s.id));
    for (const [id, el] of [...this.draftEls]) if (!live.has(id) || ids.has(id)) { el.remove(); this.draftEls.delete(id); }
    for (const s of drafts) {
      if (ids.has(s.id)) continue;
      const el = this.draftEls.get(s.id);
      if (el) el.setAttribute("d", strokePath(s.pts));
      else { const fresh = this.strokeEl(s); fresh.setAttribute("opacity", "0.75"); this.sketchLayer.appendChild(fresh); this.draftEls.set(s.id, fresh); }
    }
    this.sketchBox = sketchBounds(strokes);
  }

  // ---- presence ----

  /** Client pixels to board coordinates, through the camera. */
  toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return { x: this.cam.cx + (clientX - r.left - this.view.w / 2) / this.cam.scale, y: this.cam.cy + (clientY - r.top - this.view.h / 2) / this.cam.scale };
  }

  /** The part of the board on screen. */
  viewRect(): Rect {
    const [x, y, w, h] = viewBoxOf(this.cam, this.view);
    return { x, y, w, h };
  }

  /** Other people's cursors: an arrow and a name tag each, kept at screen size and eased toward each new position. */
  setCursors(list: readonly Cursor[]) {
    const seen = new Set<string>();
    for (const c of list) {
      seen.add(c.id);
      let cur = this.cursors.get(c.id);
      if (!cur) {
        const g = document.createElementNS(NS, "g");
        cur = { g, x: c.x, y: c.y, tx: c.x, ty: c.y };
        this.cursors.set(c.id, cur);
        this.cursorLayer.appendChild(g);
      }
      cur.tx = c.x; cur.ty = c.y;
      const sig = c.name + "|" + c.color;
      if (cur.g.dataset.sig !== sig) {
        cur.g.dataset.sig = sig;
        cur.g.replaceChildren();
        const arrow = document.createElementNS(NS, "path");
        arrow.setAttribute("d", "M0 0 L0 17 L4.6 12.6 L8 20 L11 18.7 L7.7 11.4 L13.6 11.4 Z");
        arrow.setAttribute("fill", c.color); arrow.setAttribute("stroke", "#fff"); arrow.setAttribute("stroke-width", "1.4"); arrow.setAttribute("stroke-linejoin", "round");
        const w = [...c.name].length * 6.9 + 14;
        const tag = document.createElementNS(NS, "rect");
        tag.setAttribute("x", "12"); tag.setAttribute("y", "19"); tag.setAttribute("width", String(w)); tag.setAttribute("height", "19"); tag.setAttribute("rx", "9.5"); tag.setAttribute("fill", c.color);
        const name = document.createElementNS(NS, "text");
        name.setAttribute("x", "19"); name.setAttribute("y", "29"); name.setAttribute("dominant-baseline", "central");
        name.setAttribute("font-family", "'Instrument Sans', system-ui, sans-serif"); name.setAttribute("font-size", "12"); name.setAttribute("font-weight", "600"); name.setAttribute("fill", "#fff");
        name.textContent = c.name;
        cur.g.append(arrow, tag, name);
      }
    }
    for (const [id, cur] of [...this.cursors]) if (!seen.has(id)) { cur.g.remove(); this.cursors.delete(id); }
    this.placeCursors(0);
  }

  private placeCursors(dt: number) {
    if (!this.cursors.size) return;
    const k = dt > 0 ? 1 - Math.exp(-dt / 70) : 0;
    const s = 1 / this.cam.scale;
    for (const c of this.cursors.values()) {
      c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k;
      c.g.setAttribute("transform", `translate(${c.x} ${c.y}) scale(${s})`);
    }
  }

  /**
   * A region of the board, sketch included, as a base64 PNG (no `data:` prefix) on white: the picture of a
   * sketch that goes to Claude. Its longest side is at most `maxSide` pixels. Null if it cannot be made.
   */
  async exportPng(region: Rect, maxSide = 1400): Promise<string | null> {
    try {
      if (!(region.w > 0) || !(region.h > 0)) return null;
      const k = Math.min(2, maxSide / Math.max(region.w, region.h));
      const width = Math.max(1, Math.round(region.w * k)), height = Math.max(1, Math.round(region.h * k));
      const svg = standaloneSvg(this.svg, { viewBox: [region.x, region.y, region.w, region.h], width, height });
      return await svgToPng(svg, width, height);
    } catch {
      return null;
    }
  }

  /** The board as a standalone SVG file, styles inlined. */
  exportSvg(): string {
    return standaloneSvg(this.svg);
  }

  setTarget(tree: RenderTree, bounds: Rect) {
    this.target = tree;
    this.bounds = bounds;
  }
  move() { /* moves are resolved in the tick loop by comparing shown vs target */ }

  async draw(key: string, speed: number) {
    const t = this.target.map.get(key);
    if (!t || this.shown.has(key)) return;
    const vis = buildVisual(t, t.geom);
    const layer = this.layerOf(t);
    this.insert(layer, t, vis.g);
    measure(vis);
    const s: Shown = { item: t, geom: t.geom, vis, layer, busy: true };
    this.shown.set(key, s);
    this.tag(s);
    this.highlight(s);
    this.setFocus(t.geom);
    this.lastActive = performance.now();
    if (!isFinite(speed)) { showAll(vis); s.busy = false; return; }
    const sp = speed * this.userSpeed;
    hideForDraw(vis);
    hideStamp(vis);
    for (const { phase } of entrancePlan("draw", !!vis.stamps?.length, sp)) {
      if (phase === "stroke") await this.drawStrokes(s, sp);
      else if (phase === "fill") {
        await this.frame(240 / sp, (p) => {
          for (const f of vis.fills) f.style.opacity = String(p * parseFloat(f.getAttribute("opacity") ?? "1"));
        });
        for (const f of vis.fills) f.style.opacity = "";
      } else if (phase === "stamp") await enterStamp(vis, (d, fn) => this.frame(d, fn), sp);
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
    const hasNewStamp = vis.stamps?.length && t.data.service !== s.item.data.service;
    s.layer.replaceChild(vis.g, s.vis.g);
    s.vis = vis;
    s.item = { ...t, geom: s.geom };
    this.tag(s);
    this.highlight(s);
    if (!instant) {
      hideText(vis);
      if (hasNewStamp) hideStamp(vis);
      await this.writeText(s, sp);
      if (hasNewStamp) await enterStamp(vis, (d, fn) => this.frame(d, fn), sp);
      this.hidePen();
    }
    s.busy = false;
  }

  /**
   * A proposal kept: the ink look is drawn over the pencil stroke by stroke, then its fills, stamp and text fade in
   * while the pencil fades out. Nothing is struck out: the content is the same.
   */
  async ink(key: string, speed: number) {
    const s = this.shown.get(key);
    const t = this.target.map.get(key);
    if (!s || !t || !!s.item.data.pencil === !!t.data.pencil) return;
    s.busy = true;
    const item: RenderItem = { ...s.item, data: { ...s.item.data, pencil: t.data.pencil } };
    const vis = buildVisual(item, s.geom);
    const old = s.vis;
    // the fading pencil is no longer clickable
    delete old.g.dataset.pencil;
    delete old.g.dataset.selected;
    s.layer.insertBefore(vis.g, old.g.nextSibling);
    measure(vis);
    s.vis = vis;
    s.item = item;
    this.tag(s);
    try {
      if (isFinite(speed)) {
        const sp = speed * this.userSpeed;
        this.setFocus(s.geom);
        this.lastActive = performance.now();
        hideForDraw(vis);
        hideStamp(vis);
        await this.drawStrokes(s, sp);
        this.hidePen();
        await this.frame(320 / sp, (p) => {
          old.g.style.opacity = String(1 - p);
          for (const f of vis.fills) f.style.opacity = String(p * parseFloat(f.getAttribute("opacity") ?? "1"));
          for (const st of vis.stamps ?? []) st.style.opacity = String(p);
          for (const r of vis.texts) for (const c of r.chars) c.setAttribute("fill-opacity", String(p));
        });
        for (const st of vis.stamps ?? []) st.style.opacity = "";
      }
    } finally {
      showAll(vis);
      old.g.remove();
      s.busy = false;
    }
  }

  async remove(keys: string[], speed: number) {
    const list = keys.map((k) => this.shown.get(k)).filter((x): x is Shown => !!x);
    for (const s of list) { s.busy = true; s.tween = undefined; }
    if (isFinite(speed) && list.length) {
      const sp = speed * this.userSpeed;
      await this.frame(300 / sp, (p) => {
        for (const s of list) {
          // a pencil item starts from its own see-through look
          s.vis.g.style.opacity = String((1 - p) * parseFloat(s.vis.g.getAttribute("opacity") ?? "1"));
          if (s.vis.translates) {
            const k = 1 - 0.35 * p, cx = s.geom.w / 2, cy = s.geom.h / 2;
            s.vis.g.setAttribute("transform", `translate(${s.geom.x + cx * (1 - k)} ${s.geom.y + cy * (1 - k)}) scale(${k})`);
          }
        }
      });
    }
    for (const [k, s] of [...this.shown]) if (list.includes(s)) { s.vis.g.remove(); this.shown.delete(k); }
  }

  /** Marks these items as selected (the outline the stylesheet gives `[data-selected]`); [] clears it. */
  select(keys: readonly string[]) {
    this.selected = new Set(keys);
    for (const s of this.shown.values()) this.tag(s);
  }

  /** Where an item is on screen (client pixels, after pan and zoom); null if it is not drawn. */
  screenRect(key: string): DOMRect | null {
    return this.shown.get(key)?.vis.g.getBoundingClientRect() ?? null;
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
    this.placeCursors(dt);
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

  /** set_service on something already drawn: no strike-out or redraw; the stamp pops in on top (or is removed). */
  private async restamp(s: Shown, t: RenderItem) {
    s.busy = true;
    removeStamp(s.vis);
    s.item = { ...s.item, data: { ...s.item.data, service: t.data.service } };
    addServiceIcon(s.vis, s.item, s.geom);
    const withStamp = !!s.vis.stamps?.length;
    const speed = Number.isFinite(this.userSpeed) ? this.userSpeed : 1;
    try {
      for (const { phase } of entrancePlan("set_service", withStamp, speed)) {
        if (phase === "stamp") { hideStamp(s.vis); await enterStamp(s.vis, (d, fn) => this.frame(d, fn), speed); }
      }
    } catch { /* cancelled: the stamp stays as it is */ }
    s.busy = false;
  }

  private applyGeom(s: Shown, g: Geom, hue: number) {
    const sameSize = Math.abs(g.w - s.geom.w) < 0.01 && Math.abs(g.h - s.geom.h) < 0.01 && !g.pts;
    if (s.vis.translates && sameSize && hue === s.item.hue) {
      s.vis.g.setAttribute("transform", `translate(${g.x} ${g.y})`);
    } else {
      const item: RenderItem = { ...s.item, hue, geom: g };
      const vis = buildVisual(item, g);
      showAll(vis);
      s.layer.replaceChild(vis.g, s.vis.g);
      s.vis = vis;
      s.item = item;
      this.tag(s);
    }
    s.geom = g;
    s.item = { ...s.item, geom: g, hue };
  }

  private async drawStrokes(s: Shown, sp: number) {
    const total = s.vis.strokes.reduce((a, b) => a + b.len, 0);
    const rate = Math.max(1.5, total / 2400) * sp;
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
        const pt = cur.run.node.getStartPositionOfChar(cur.run.offsets[cur.i]);
        this.movePen(pt.x + ox + 6, pt.y + oy + 6);
      } catch { /* not measurable yet */ }
    });
    flat.forEach((f) => f.run.chars[f.i].removeAttribute("fill-opacity"));
  }

  private async strike(s: Shown, sp: number) {
    const lines: SVGPathElement[] = [];
    for (const run of s.vis.texts) {
      const b = run.node.getBBox();
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

  /** The data attributes hit-testing and the selection outline read. */
  private tag(s: Shown) {
    const d = s.vis.g.dataset;
    d.key = s.item.key;
    if (s.item.data.pencil) d.pencil = ""; else delete d.pencil;
    if (this.selected.has(s.item.key)) d.selected = ""; else delete d.selected;
  }

  private highlight(s: Shown) {
    const g = s.vis.g;
    let node: SVGElement;
    const kind = s.item.kind;
    if (kind === "connection" && s.vis.strokes[0]) {
      node = document.createElementNS(NS, "path");
      node.setAttribute("d", s.vis.strokes[0].anim.getAttribute("d")!);
      node.setAttribute("fill", "none"); node.setAttribute("stroke", "#ffe066"); node.setAttribute("stroke-width", "16"); node.setAttribute("stroke-linecap", "round");
    } else {
      const r = document.createElementNS(NS, "rect");
      const gm = s.geom;
      const local = s.vis.translates;
      const header = kind === "zone" || kind === "group";
      const w = header ? Math.min(gm.w, (s.item.data.title?.length ?? 4) * 14 + 56) : gm.w;
      const h = header ? 52 : gm.h;
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

  /** Groups go under every group nested deeper, so a box never covers the boxes inside it. */
  private insert(layer: SVGGElement, item: RenderItem, g: SVGGElement) {
    if (item.kind !== "group") { layer.appendChild(g); return; }
    const depth = item.data.depth ?? 0;
    const deeper = [...layer.children].find((c) => Number((c as SVGGElement).dataset.depth) > depth);
    layer.insertBefore(g, deeper ?? null);
  }

  private layerOf(i: RenderItem) {
    if (i.under) return this.layers.under;
    if (i.kind === "group") return this.layers.group;
    return i.kind === "zone" ? this.layers.zone : i.kind === "connection" ? this.layers.connection : i.kind === "element" ? this.layers.element : this.layers.ann;
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
    const auto = this.follow && nowReal >= this.manualUntil && !this.drawing;
    if (this.anims.length || [...this.shown.values()].some((s) => s.busy)) this.lastActive = nowReal;
    const bounds = this.frameBounds();
    if (auto && bounds.w > 0 && bounds.h > 0) {
      const idle = nowReal - this.lastActive > IDLE_OVERVIEW_MS;
      const tgt = targetCam(this.focus, bounds, this.view, idle);
      this.cam = this.camInit ? stepCam(this.cam, tgt, dt) : tgt;
      this.camInit = true;
    } else if (!this.camInit) {
      this.cam = targetCam(null, this.bounds.w ? this.bounds : { x: 0, y: 0, w: this.view.w, h: this.view.h }, this.view);
    }
    this.applyViewBox();
  }
  /** What the camera frames: the diagram and the ink around it, so a stroke off the diagram is never lost. */
  private frameBounds(): Rect {
    const b = this.bounds, s = this.sketchBox;
    if (!s) return b;
    // a lone dot or a flat line still needs a box with some size
    const ink = { x: s.x - 20, y: s.y - 20, w: s.w + 40, h: s.h + 40 };
    if (!(b.w > 0)) return ink;
    const x = Math.min(b.x, ink.x), y = Math.min(b.y, ink.y);
    return { x, y, w: Math.max(b.x + b.w, ink.x + ink.w) - x, h: Math.max(b.y + b.h, ink.y + ink.h) - y };
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
    // A press that moves less than this is a click, not a pan.
    let press: { x: number; y: number; key: string | null } | null = null;
    // The stroke under the pen: its points so far and the path that shows it.
    let stroke: { id: string; pts: number[]; el: SVGPathElement; drafted: number } | null = null;
    let erasing = false;
    // Two fingers: pinch to zoom, move both to pan.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; cx: number; cy: number } | null = null;
    const twoFingers = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };

    const endStroke = (keep: boolean) => {
      if (!stroke) return;
      const s = stroke;
      stroke = null;
      this.drawing = false;
      if (keep) this.sketch?.add({ id: s.id, by: this.author, color: this.penColor, pts: tidyStroke(s.pts) });
      s.el.remove();
      this.sketch?.draft(null);
      this.manualUntil = performance.now() + HOLD_AFTER_DRAW_MS;
      this.camInit = true;
      this.onDrawing?.(false);
    };
    const eraseAt = (e: PointerEvent) => {
      const store = this.sketch;
      if (!store) return;
      const p = this.toBoard(e.clientX, e.clientY), r = ERASER_PX / this.cam.scale;
      const hit = store.strokes().filter((s) => hitStroke(s.pts, p.x, p.y, r)).map((s) => s.id);
      if (hit.length) store.remove(hit);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      if (touches.size === 2) {
        // a second finger turns whatever the first one started into a pinch
        endStroke(false);
        erasing = false; drag = null; press = null;
        pinch = twoFingers();
        return;
      }
      if (e.button === 2) return;
      const panning = this.currentTool === "pan" || e.button === 1 || this.spaceHeld;
      if (panning) {
        if (this.spaceHeld) spacePan.used = true;
        if (e.button === 1) e.preventDefault();
        // Read before the capture: from then on the svg is the target. Ink is never picked.
        const hit = (e.target as Element).closest?.("[data-key]");
        press = this.currentTool === "pan" && e.button === 0 && !this.spaceHeld
          ? { x: e.clientX, y: e.clientY, key: hit && hit.hasAttribute("data-pencil") ? hit.getAttribute("data-key") : null }
          : null;
        drag = { x: e.clientX, y: e.clientY };
        svg.dataset.panning = "";
        return;
      }
      if (e.button !== 0 || !this.sketch) return;
      if (this.currentTool === "eraser") { erasing = true; this.manual(); eraseAt(e); return; }
      const p = this.toBoard(e.clientX, e.clientY);
      const el = this.strokeEl({ color: this.penColor, pts: [p.x, p.y] });
      this.sketchLayer.appendChild(el);
      stroke = { id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), pts: [p.x, p.y], el, drafted: 0 };
      this.drawing = true;
      this.camInit = true;
      this.onDrawing?.(true);
    };
    const move = (e: PointerEvent) => {
      // Reported after the camera moves: a pan keeps the pointer on the same spot of the board, so nobody
      // else sees this cursor shake while the board is dragged.
      const report = () => this.onPointer?.(this.toBoard(e.clientX, e.clientY));
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const now = twoFingers();
        const r = svg.getBoundingClientRect();
        this.cam = zoomAt(this.cam, this.view, now.cx - r.left, now.cy - r.top, now.d / pinch.d);
        this.cam = { ...this.cam, cx: this.cam.cx - (now.cx - pinch.cx) / this.cam.scale, cy: this.cam.cy - (now.cy - pinch.cy) / this.cam.scale };
        pinch = now;
        this.manual();
        report();
        return;
      }
      if (drag) {
        this.cam = { ...this.cam, cx: this.cam.cx - (e.clientX - drag.x) / this.cam.scale, cy: this.cam.cy - (e.clientY - drag.y) / this.cam.scale };
        drag = { x: e.clientX, y: e.clientY };
        this.manual();
      } else if (stroke) {
        const s = stroke;
        // the browser may fold several moves into one event: use them all, the line comes out smoother
        const steps = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        for (const ev of steps.length ? steps : [e]) {
          const p = this.toBoard(ev.clientX, ev.clientY);
          const n = s.pts.length;
          if (Math.hypot(p.x - s.pts[n - 2], p.y - s.pts[n - 1]) * this.cam.scale < 1) continue;
          s.pts.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
        }
        s.el.setAttribute("d", strokePath(s.pts));
        const now = performance.now();
        if (now - s.drafted > 80) { s.drafted = now; this.sketch?.draft({ id: s.id, by: this.author, color: this.penColor, pts: tidyStroke(s.pts) }); }
      } else if (erasing) eraseAt(e);
      report();
    };
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      endStroke(e.type === "pointerup");
      erasing = false;
      drag = null;
      delete svg.dataset.panning;
      if (press && e.type === "pointerup" && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) this.onPick?.(press.key);
      press = null;
    };
    const leave = () => this.onPointer?.(null);
    // Space held: any drag pans, whatever the tool.
    const keyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      this.spaceHeld = true;
      svg.dataset.space = "";
    };
    const release = () => { this.spaceHeld = false; delete svg.dataset.space; };
    const keyUp = (e: KeyboardEvent) => { if (e.code === "Space") release(); };
    const noMenu = (e: Event) => { if (this.currentTool !== "pan") e.preventDefault(); };
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("contextmenu", noMenu);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    this.cleanup.push(() => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", down);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      svg.removeEventListener("pointerleave", leave);
      svg.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
    });
  }
}
