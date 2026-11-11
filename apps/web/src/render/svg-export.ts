const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "visibility", "display",
];

/** A part of the drawing to export instead of what is on screen: its viewBox and the size in pixels. */
export interface ExportFrame { viewBox: [number, number, number, number]; width: number; height: number }

/** Serializes an SVG with its computed styles inlined, so it looks the same opened alone. `frame` picks a region. */
export function standaloneSvg(src: SVGSVGElement, frame?: ExportFrame): string {
  const clone = src.cloneNode(true) as SVGSVGElement;
  const a = [src, ...Array.from(src.querySelectorAll("*"))];
  const b = [clone, ...Array.from(clone.querySelectorAll("*"))];
  a.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = b[i] as SVGElement;
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) target.style.setProperty(p, v);
    }
  });
  // clickable areas and selection marks are for the screen only
  clone.querySelectorAll("[data-hit]").forEach((el) => el.remove());
  clone.querySelectorAll("[data-selected]").forEach((el) => el.removeAttribute("data-selected"));
  clone.querySelectorAll("[data-reading]").forEach((el) => { el.removeAttribute("data-reading"); (el as SVGElement).style.removeProperty("opacity"); });
  const r = src.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(frame?.width ?? Math.round(r.width)));
  clone.setAttribute("height", String(frame?.height ?? Math.round(r.height)));
  if (frame) clone.setAttribute("viewBox", frame.viewBox.join(" "));
  clone.style.background = "#ffffff";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}
