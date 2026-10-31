import { hasWakeWord } from "../instruction";

// Agrupa finales de voz: vacía tras GROUP_WINDOW_MS sin finales nuevos, o ya si el búfer supera GROUP_MAX_CHARS.
export const GROUP_WINDOW_MS = 800;
export const GROUP_MAX_CHARS = 250;
/** Ventana más larga mientras el búfer lleva la palabra de activación: el reconocedor parte las órdenes. */
export const INSTRUCTION_WINDOW_MS = 2000;

export interface Grouper {
  push(text: string): void;
  flush(): void;
  cancel(): void;
}

/** flush recibe el texto junto y el instante (Date.now) en que llegó el ÚLTIMO final. */
export function createGrouper(
  flush: (text: string, lastFinalAt: number) => void,
  windowMs = GROUP_WINDOW_MS,
  maxChars = GROUP_MAX_CHARS,
): Grouper {
  let buf: string[] = [];
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer) { clearTimeout(timer); timer = undefined; } };
  const doFlush = () => {
    clear();
    if (!buf.length) return;
    const text = buf.join(" ");
    buf = [];
    flush(text, lastAt);
  };
  return {
    push(t) {
      const s = t.trim();
      if (!s) return;
      buf.push(s);
      lastAt = Date.now();
      const joined = buf.join(" ");
      const instr = hasWakeWord(joined);
      if (!instr && joined.length > maxChars) return doFlush();
      clear();
      timer = setTimeout(doFlush, instr ? Math.max(windowMs, INSTRUCTION_WINDOW_MS) : windowMs);
    },
    flush: doFlush,
    cancel() { clear(); buf = []; },
  };
}
