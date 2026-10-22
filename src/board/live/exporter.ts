// Exportar: descarga de archivos y SVG del tablero con estilos en línea (se ve igual abierto solo).
const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "visibility", "display",
];

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Serializa el SVG del tablero copiando los estilos calculados a cada elemento. null si no hay tablero. */
export function boardSvgText(): string | null {
  const src = document.querySelector<SVGSVGElement>(".canvas2 svg");
  if (!src) return null;
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
