// Cola con una sola petición en vuelo; lo que llega mientras tanto se junta.
export type TextKind = "content" | "instruction";

export interface TextInput {
  /** Llamar con cada fragmento final de texto (dictado simulado hoy, voz mañana). */
  onFinalText(text: string, kind?: TextKind): void;
}

export interface Scheduler extends TextInput {
  stop(): void;
  isBusy(): boolean;
  pending(): string;
}

export function createScheduler(send: (text: string, kind: TextKind) => Promise<void>, onIdle?: () => void): Scheduler {
  let buffer: { text: string; kind: TextKind }[] = [];
  let inFlight = false;
  let stopped = false;

  async function pump() {
    if (inFlight || stopped || buffer.length === 0) return;
    // Tanda inicial del mismo tipo: el contenido se junta, cada instrucción va sola.
    const kind = buffer[0].kind;
    let n = 1;
    if (kind === "content") while (n < buffer.length && buffer[n].kind === "content") n++;
    const text = buffer.slice(0, n).map((b) => b.text).join(" ");
    buffer = buffer.slice(n);
    inFlight = true;
    try {
      await send(text, kind);
    } catch {
      /* el que envía registra su propio error */
    } finally {
      inFlight = false;
    }
    if (buffer.length && !stopped) void pump();
    else onIdle?.();
  }

  return {
    onFinalText(text, kind = "content") {
      const t = text.trim();
      if (!t) return;
      stopped = false;
      buffer.push({ text: t, kind });
      void pump();
    },
    stop() {
      stopped = true;
      buffer = [];
    },
    isBusy: () => inFlight,
    pending: () => buffer.map((b) => b.text).join(" "),
  };
}
