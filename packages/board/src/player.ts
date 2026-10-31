// Demo player: virtual clock (pause and speed) + word-by-word subtitles
// + delivery of ops after Claude's simulated latency.
import type { Op } from "@grafito/contract";

export interface DemoChunk { at_ms: number; text: string; ops: Op[] }
export type Demo = DemoChunk[];

export const MS_PER_WORD = 440;
export const speakMs = (text: string) => text.trim().split(/\s+/).length * MS_PER_WORD;
/** deterministic 1.5–3 s latency depending on the chunk index */
export const latencyMs = (i: number) => 1500 + ((i * 7919) % 11) * 150;

/** Demo builder: computes at_ms by accumulating speaking time plus a short pause. */
export function timeline(chunks: { text: string; ops: Op[] }[], startMs = 600, pauseMs = 800): Demo {
  let t = startMs;
  return chunks.map((c) => {
    const out = { at_ms: t, text: c.text, ops: c.ops };
    t += speakMs(c.text) + pauseMs;
    return out;
  });
}

export interface Subtitle { spoken: string[]; current: string; interim?: boolean }
export interface PlayerHooks {
  onSubtitle(s: Subtitle): void;
  onOps(ops: Op[], chunkIndex: number): void;
  onEnd(): void;
}

interface Ev { t: number; run: () => void }

export class Player {
  clock = 0;
  private events: Ev[] = [];
  private next = 0;
  private endAt = 0;
  private ended = false;

  constructor(private script: Demo, private hooks: PlayerHooks) {
    this.build();
  }

  private build() {
    const spoken: string[] = [];
    this.script.forEach((c, i) => {
      const words = c.text.trim().split(/\s+/);
      words.forEach((_, w) => {
        this.events.push({
          t: c.at_ms + w * MS_PER_WORD,
          run: () => this.hooks.onSubtitle({ spoken: [...spoken], current: words.slice(0, w + 1).join(" ") }),
        });
      });
      const speakEnd = c.at_ms + words.length * MS_PER_WORD;
      this.events.push({
        t: speakEnd,
        run: () => { spoken.push(c.text); this.hooks.onSubtitle({ spoken: [...spoken], current: "" }); },
      });
      const opsAt = speakEnd + latencyMs(i);
      this.events.push({ t: opsAt, run: () => this.hooks.onOps(c.ops, i) });
      this.endAt = Math.max(this.endAt, opsAt);
    });
    this.events.sort((a, b) => a.t - b.t);
    this.endAt += 1500;
  }

  get duration() { return this.endAt; }

  tick(dtMs: number) {
    if (this.ended) return;
    this.clock += dtMs;
    while (this.next < this.events.length && this.events[this.next].t <= this.clock) this.events[this.next++].run();
    if (this.clock >= this.endAt) { this.ended = true; this.hooks.onEnd(); }
  }
}
