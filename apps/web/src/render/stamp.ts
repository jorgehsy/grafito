// The service stamp: the official 30 px icon, tilted, pinned to the element's top-left corner.
// The pure parts (order, timing, SVG text) are tested without a DOM; the rest builds nodes and animates them.
import type { Geom, RenderItem } from "@grafito/board";
import type { Visual } from "./visuals";
import { AWS_ICONS } from "../icons/aws";
import { AWS_CATALOG_ID } from "@grafito/icons";

const NS = "http://www.w3.org/2000/svg";
export const STAMP_PX = 30;
export const STAMP_ROT = -7;
const VIEWBOX = 80;
/** Entrance duration at speed 1. */
export const STAMP_MS = 320;

export type Phase = "stroke" | "fill" | "stamp" | "text";

/** What shows and in what order. `draw`: new element. `set_service`: already drawn, only the stamp pops in. */
export function entrancePlan(action: "draw" | "set_service", withStamp: boolean, sp = 1): { phase: Phase; dur?: number }[] {
  if (action === "set_service") return withStamp ? [{ phase: "stamp", dur: STAMP_MS / sp }] : [];
  const phases: { phase: Phase; dur?: number }[] = [{ phase: "stroke" }, { phase: "fill" }];
  if (withStamp) phases.push({ phase: "stamp", dur: STAMP_MS / sp });
  phases.push({ phase: "text" });
  return phases;
}

/** Start time of each phase given the durations of the others (the stamp phase carries its own). */
export function phaseStarts(plan: { phase: Phase; dur?: number }[], durations: Partial<Record<Phase, number>>): Partial<Record<Phase, number>> {
  const out: Partial<Record<Phase, number>> = {};
  let t = 0;
  for (const f of plan) { out[f.phase] = t; t += f.dur ?? durations[f.phase] ?? 0; }
  return out;
}

/** Pop scale: 0 -> 1.18 (at 70 % of the time) -> 1. */
export function stampScale(p: number): number {
  return p < 0.7 ? (p / 0.7) * 1.18 : 1.18 - ((p - 0.7) / 0.3) * 0.18;
}

/** `aws:lambda` -> `lambda`. */
export const serviceIdOf = (service: string) => service.replace(new RegExp(`^${AWS_CATALOG_ID}:`), "");

/** Stamp center in the element's local coordinates. Diamond: on its top-left side; everything else: the corner. */
export function stampCenter(variant: string, w: number, h: number): { x: number; y: number } {
  const x = variant === "decision" ? w / 2 - 34 : 0, y = variant === "decision" ? h / 4 - 6 : 0;
  return { x: x + 4, y: y + 4 };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Strips the root `<svg>` and `<title>`s, and prepends `prefix` to every inner `id` and its references (so ids never repeat). */
export function prefixedIconBody(svg: string, prefix: string): string {
  let body = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/g, "");
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const e = esc(id);
    body = body
      .replace(new RegExp(`(\\sid=")${e}"`, "g"), `$1${prefix}${id}"`)
      .replace(new RegExp(`url\\((['"]?)#${e}\\1\\)`, "g"), `url($1#${prefix}${id}$1)`)
      .replace(new RegExp(`((?:xlink:)?href=")#${e}"`, "g"), `$1#${prefix}${id}"`);
  }
  return body;
}

/** The stamp `<g>` as text: the official SVG inlined (no `<image>`), scaled from viewBox 80 to 30 px. null if the service has no icon. */
export function stampMarkup(service: string, center: { x: number; y: number }, prefix: string): string | null {
  const svg = AWS_ICONS[serviceIdOf(service)];
  if (!svg) return null;
  const k = STAMP_PX / VIEWBOX;
  const tx = center.x - STAMP_PX / 2, ty = center.y - STAMP_PX / 2;
  return (
    `<g data-stamp="${serviceIdOf(service)}" data-origin="${center.x} ${center.y}" data-rot="${STAMP_ROT}" ` +
    `transform="translate(${center.x} ${center.y}) rotate(${STAMP_ROT}) translate(${-center.x} ${-center.y})">` +
    `<g transform="translate(${tx} ${ty}) scale(${k})">${prefixedIconBody(svg, prefix)}</g></g>`
  );
}

let stampCounter = 0;

/** Adds the stamp to the element's Visual (local coordinates). */
export function addServiceIcon(v: Visual, item: RenderItem, geom: Geom) {
  const service = item.data.service as string | undefined;
  if (!service || item.kind !== "element") return;
  const markup = stampMarkup(service, stampCenter(item.data.variant as string, geom.w, geom.h), `stamp${++stampCounter}-`);
  if (!markup) return;
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup}</svg>`, "image/svg+xml");
  const g = document.importNode(doc.documentElement.firstElementChild!, true) as SVGGElement;
  v.g.appendChild(g);
  (v.stamps ??= []).push(g);
}

export function hideStamp(v: Visual) {
  for (const g of v.stamps ?? []) g.style.opacity = "0";
}

export function removeStamp(v: Visual) {
  for (const g of v.stamps ?? []) g.remove();
  v.stamps = [];
}

/** Decal pop. `frame` is the engine's. */
export async function enterStamp(v: Visual, frame: (dur: number, fn: (p: number) => void) => Promise<void>, sp: number) {
  const list = v.stamps ?? [];
  if (!list.length) return;
  await frame(STAMP_MS / sp, (p) => {
    const s = stampScale(p);
    for (const g of list) {
      const [ox, oy] = g.getAttribute("data-origin")!.split(" ");
      g.style.opacity = "1";
      g.setAttribute("transform", `translate(${ox} ${oy}) rotate(${g.getAttribute("data-rot")}) scale(${s}) translate(${-ox} ${-oy})`);
    }
  });
  for (const g of list) g.style.opacity = "";
}
