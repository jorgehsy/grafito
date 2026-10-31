// El sello de servicio: icono oficial de 30 px, torcido, montado en la esquina de arriba a la izquierda.
// Lo puro (orden, tiempos y el SVG en texto) se prueba sin DOM; lo demás arma nodos y los anima.
import type { Geom, RenderItem } from "@grafito/board";
import type { Visual } from "./visuals";
import { ICONOS_AWS } from "../iconos/aws";
import { AWS_CATALOG_ID } from "@grafito/icons";

const NS = "http://www.w3.org/2000/svg";
export const SELLO_PX = 30;
export const SELLO_ROT = -7;
const VIEWBOX = 80;
/** Duración de la entrada a velocidad 1. */
export const SELLO_MS = 320;

// ---------- orden y tiempos (puro) ----------
export type Fase = "trazo" | "relleno" | "sello" | "texto";

/** Qué se muestra y en qué orden. `dibujar`: elemento nuevo. `set_service`: ya estaba dibujado, solo salta el sello. */
export function planEntrada(accion: "dibujar" | "set_service", conSello: boolean, sp = 1): { fase: Fase; dur?: number }[] {
  if (accion === "set_service") return conSello ? [{ fase: "sello", dur: SELLO_MS / sp }] : [];
  const fases: { fase: Fase; dur?: number }[] = [{ fase: "trazo" }, { fase: "relleno" }];
  if (conSello) fases.push({ fase: "sello", dur: SELLO_MS / sp });
  fases.push({ fase: "texto" });
  return fases;
}

/** Instante de inicio de cada fase dadas las duraciones de las demás (el sello trae la suya). */
export function iniciosDeFases(plan: { fase: Fase; dur?: number }[], durs: Partial<Record<Fase, number>>): Partial<Record<Fase, number>> {
  const out: Partial<Record<Fase, number>> = {};
  let t = 0;
  for (const f of plan) { out[f.fase] = t; t += f.dur ?? durs[f.fase] ?? 0; }
  return out;
}

/** Escala del salto: 0 -> 1,18 (70 % del tiempo) -> 1. */
export function escalaSello(p: number): number {
  return p < 0.7 ? (p / 0.7) * 1.18 : 1.18 - ((p - 0.7) / 0.3) * 0.18;
}

/** `aws:lambda` -> `lambda`. */
export const idDeServicio = (service: string) => service.replace(new RegExp(`^${AWS_CATALOG_ID}:`), "");

/** Centro del sello en coordenadas locales del elemento. Rombo: sobre su lado de arriba a la izquierda; el resto, la esquina. */
export function centroSello(variant: string, w: number, h: number): { x: number; y: number } {
  const x = variant === "decision" ? w / 2 - 34 : 0, y = variant === "decision" ? h / 4 - 6 : 0;
  return { x: x + 4, y: y + 4 };
}

// ---------- SVG incrustado (puro) ----------
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Quita el `<svg>` raíz y los `<title>`, y antepone `prefijo` a cada `id` interno y a sus referencias (para no repetir ids). */
export function cuerpoIconoPrefijado(svg: string, prefijo: string): string {
  let body = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/g, "");
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const e = esc(id);
    body = body
      .replace(new RegExp(`(\\sid=")${e}"`, "g"), `$1${prefijo}${id}"`)
      .replace(new RegExp(`url\\((['"]?)#${e}\\1\\)`, "g"), `url($1#${prefijo}${id}$1)`)
      .replace(new RegExp(`((?:xlink:)?href=")#${e}"`, "g"), `$1#${prefijo}${id}"`);
  }
  return body;
}

/** `<g>` del sello como texto: SVG oficial incrustado (sin `<image>`), escalado de viewBox 80 a 30 px. null si el servicio no tiene icono. */
export function selloMarkup(service: string, centro: { x: number; y: number }, prefijo: string): string | null {
  const svg = ICONOS_AWS[idDeServicio(service)];
  if (!svg) return null;
  const k = SELLO_PX / VIEWBOX;
  const tx = centro.x - SELLO_PX / 2, ty = centro.y - SELLO_PX / 2;
  return (
    `<g data-sello="${idDeServicio(service)}" data-origin="${centro.x} ${centro.y}" data-rot="${SELLO_ROT}" ` +
    `transform="translate(${centro.x} ${centro.y}) rotate(${SELLO_ROT}) translate(${-centro.x} ${-centro.y})">` +
    `<g transform="translate(${tx} ${ty}) scale(${k})">${cuerpoIconoPrefijado(svg, prefijo)}</g></g>`
  );
}

// ---------- DOM ----------
let selloN = 0;

/** Añade el sello al Visual del elemento (coordenadas locales). */
export function addServiceIcon(v: Visual, item: RenderItem, geom: Geom) {
  const service = item.data.service as string | undefined;
  if (!service || item.kind !== "element") return;
  const markup = selloMarkup(service, centroSello(item.data.variant as string, geom.w, geom.h), `sello${++selloN}-`);
  if (!markup) return;
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup}</svg>`, "image/svg+xml");
  const g = document.importNode(doc.documentElement.firstElementChild!, true) as SVGGElement;
  v.g.appendChild(g);
  (v.sello ??= []).push(g);
}

export function hideSello(v: Visual) {
  for (const g of v.sello ?? []) g.style.opacity = "0";
}

export function removeSello(v: Visual) {
  for (const g of v.sello ?? []) g.remove();
  v.sello = [];
}

/** Salto de calcomanía. `frame` es el del motor. */
export async function enterSello(v: Visual, frame: (dur: number, fn: (p: number) => void) => Promise<void>, sp: number) {
  const list = v.sello ?? [];
  if (!list.length) return;
  await frame(SELLO_MS / sp, (p) => {
    const s = escalaSello(p);
    for (const g of list) {
      const [ox, oy] = g.getAttribute("data-origin")!.split(" ");
      g.style.opacity = "1";
      g.setAttribute("transform", `translate(${ox} ${oy}) rotate(${g.getAttribute("data-rot")}) scale(${s}) translate(${-ox} ${-oy})`);
    }
  });
  for (const g of list) g.style.opacity = "";
}
