// Turns an SVG document into a PNG, in the browser: the picture of the sketch that goes to Claude.

/** `svg` drawn at w x h on white, as base64 PNG without the `data:` prefix. Null if the browser cannot do it; never throws. */
export function svgToPng(svg: string, w: number, h: number, timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const url = canvas.toDataURL("image/png");
          finish(url.startsWith("data:image/png") ? url.slice(url.indexOf(",") + 1) : null);
        } catch { finish(null); }
      };
      img.onerror = () => finish(null);
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      setTimeout(() => finish(null), timeoutMs);
    } catch { finish(null); }
  });
}
