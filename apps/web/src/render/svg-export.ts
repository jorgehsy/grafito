const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "visibility", "display",
];

/** Serializes an SVG with its computed styles inlined, so it looks the same opened alone. */
export function standaloneSvg(src: SVGSVGElement): string {
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
  const r = src.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(r.width)));
  clone.setAttribute("height", String(Math.round(r.height)));
  clone.style.background = "#ffffff";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}
