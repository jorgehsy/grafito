// Hi-fi export, browser side: the board's render tree drawn clean (see svg.ts), with the AWS icons inlined, and a
// PNG made from that SVG.
import { buildTree } from "@grafito/board";
import type { Board, BoardLayout } from "@grafito/board";
import { serviceIdOf } from "@grafito/icons";
import { AWS_ICONS } from "../../icons/aws";
import { svgToPng } from "../../sketch/rasterize";
import { renderHifi, titleFrom } from "./svg";
import type { HifiOptions, HifiResult } from "./svg";

export { renderHifi, titleFrom, DEFAULT_LABELS } from "./svg";
export type { HifiLabels, HifiOptions, HifiResult } from "./svg";

/** Service (`aws:lambda`) -> the catalog icon's SVG text. */
export const catalogIcon = (service: string): string | null => AWS_ICONS[serviceIdOf(service)] ?? null;

/** The board as a hi-fi SVG: title block from its summary and zone titles unless `opts` says otherwise. */
export function hifiFromBoard(board: Board, layout: BoardLayout, opts: HifiOptions = {}): HifiResult {
  return renderHifi(buildTree(board, layout), { icon: catalogIcon, ...titleFrom(board.summary, board.zones.map((z) => z.title)), ...opts });
}

/** Longest side a browser canvas takes safely. */
const MAX_SIDE = 8000;

/** The hi-fi SVG as PNG bytes at 2x (less for a very large board). Null if the browser cannot make it. */
export async function hifiPng(r: HifiResult, scale = 2): Promise<Uint8Array | null> {
  // Capped by side and by area (about 16 Mpx is what every browser canvas takes).
  const k = Math.min(scale, MAX_SIDE / Math.max(r.width, r.height), Math.sqrt(16e6 / (r.width * r.height)));
  const b64 = await svgToPng(r.svg, Math.round(r.width * k), Math.round(r.height * k), 8000);
  if (!b64) return null;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
