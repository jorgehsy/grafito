// Text for the hi-fi export. No font is embedded, so widths are estimated from a table of a wide system sans
// (Arial / Helvetica metrics, a little padded) and every label is shrunk until it fits its box.

/** The stack the exported SVG asks for: whatever system sans the viewer has. */
export const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const NARROW = new Set([..."iIljt.,:;'|!·()[]{}/\\ f"]);
const MEDIUM = new Set([..."r-*\"`"]);
const WIDE = new Set([..."mwMW@%—"]);

/** Width of one character in em, on the generous side. */
function charEm(ch: string): number {
  if (NARROW.has(ch)) return 0.32;
  if (MEDIUM.has(ch)) return 0.4;
  if (WIDE.has(ch)) return 0.9;
  const c = ch.codePointAt(0) ?? 0;
  if (c > 0x2e7f) return 1.05; // CJK, emoji
  if (ch >= "A" && ch <= "Z") return 0.72;
  if (ch >= "0" && ch <= "9") return 0.58;
  if (c > 0x7f && ch.toUpperCase() === ch && ch.toLowerCase() !== ch) return 0.72;
  return 0.57;
}

/** Estimated width of `s` at `size` px. Bold runs wider; monospace is a fixed 0.62 em. */
export function textWidth(s: string, size: number, weight = 400, mono = false): number {
  if (mono) return [...s].length * 0.62 * size;
  let em = 0;
  for (const ch of s) em += charEm(ch);
  return em * size * (weight >= 600 ? 1.07 : 1);
}

/** The largest size, from `size` down to `min`, at which every line fits in `maxW`. */
export function fitSize(lines: string[], maxW: number, size: number, weight = 400, min = 9): number {
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, textWidth(l, size, weight));
  if (widest <= maxW || widest === 0) return size;
  return Math.max(min, Math.floor(((size * maxW) / widest) * 10) / 10);
}

/** Greedy word wrap by estimated width; at most `maxLines`, the last one ending in an ellipsis if cut. */
export function wrapToWidth(text: string, maxW: number, size: number, weight = 400, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (!cur || textWidth(next, size, weight) <= maxW) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && textWidth(last + "…", size, weight) > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = last.replace(/[\s.,;:]+$/, "") + "…";
  return kept;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
