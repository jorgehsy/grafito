// Saves the hi-fi export as files: `<base>.svg` and, when the browser can rasterize it, `<base>.png` at 2x.
import type { Board, BoardLayout } from "@grafito/board";
import { hifiFromBoard, hifiPng } from "./index";
import type { HifiOptions } from "./index";

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads the board's hi-fi SVG and PNG. Never throws: an export that fails is skipped, the rest still saves. */
export async function saveHifi(base: string, board: Board, layout: BoardLayout, opts: HifiOptions = {}): Promise<void> {
  try {
    const r = hifiFromBoard(board, layout, opts);
    save(base + ".svg", new Blob([r.svg], { type: "image/svg+xml" }));
    const png = await hifiPng(r);
    if (png) save(base + ".png", new Blob([png.slice()], { type: "image/png" }));
  } catch (e) {
    console.warn("hi-fi export failed", e);
  }
}
