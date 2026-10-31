// Keeps one request in flight; fragments that arrive meanwhile are batched.
export type RequestMode = "content" | "instruction";

export interface TextInput {
  /** Called with each finished fragment of text. */
  onFragment(text: string, mode?: RequestMode): void;
}

export interface Scheduler extends TextInput {
  stop(): void;
  isBusy(): boolean;
  pending(): string;
}

export function createScheduler(send: (batch: string, mode: RequestMode) => Promise<void>, onIdle?: () => void): Scheduler {
  let buffer: { text: string; mode: RequestMode }[] = [];
  let inFlight = false;
  let stopped = false;

  async function pump() {
    if (inFlight || stopped || buffer.length === 0) return;
    // Content fragments are joined; each instruction goes alone.
    const mode = buffer[0].mode;
    let n = 1;
    if (mode === "content") while (n < buffer.length && buffer[n].mode === "content") n++;
    const batch = buffer.slice(0, n).map((b) => b.text).join(" ");
    buffer = buffer.slice(n);
    inFlight = true;
    try {
      await send(batch, mode);
    } catch {
      /* send records its own error */
    } finally {
      inFlight = false;
    }
    if (buffer.length && !stopped) void pump();
    else onIdle?.();
  }

  return {
    onFragment(text, mode = "content") {
      const t = text.trim();
      if (!t) return;
      stopped = false;
      buffer.push({ text: t, mode });
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
