// Demo player: a virtual clock (pause, speed and seek) over a demo timeline. Each tick it compares what the
// demo looks like now with what it last reported and calls the hooks for the difference: subtitles word by
// word, ops after Claude's simulated latency, the hand-drawn sketch. A seek does the same in one step, and
// when it changes which chunks are on the board it hands over the ops that rebuild it.
import type { Op } from "@grafito/contract";
import { clampTime, demoTimeline, opsUpTo, stateAt } from "./demo-timeline";
import type { Demo, DemoState, DemoTimeline, SketchFrame, Subtitle } from "./demo-timeline";

export interface PlayerHooks {
  onSubtitle(s: Subtitle): void;
  /** A chunk's ops land during playback: draw them animated. */
  onOps(ops: Op[], chunkIndex: number): void;
  onEnd(): void;
  /** The hand-drawn sketch changed. */
  onSketch?(frame: SketchFrame): void;
  /**
   * A seek changed which chunks are on the board. `ops` rebuild that board from an empty one and are meant to
   * be shown at once, with no animation; `delivered` is how many chunks they cover.
   */
  onJump?(ops: Op[], delivered: number): void;
}

export class Player {
  clock = 0;
  readonly timeline: DemoTimeline;
  private state: DemoState;
  private ended = false;

  constructor(script: Demo, private hooks: PlayerHooks) {
    this.timeline = demoTimeline(script);
    this.state = stateAt(this.timeline, 0);
  }

  get duration() { return this.timeline.duration; }
  get done() { return this.ended; }
  /** Index of the chapter playing now. */
  get chapter() { return this.state.chapter; }
  /** How many chunks have their ops on the board. */
  get delivered() { return this.state.delivered; }

  tick(dtMs: number) {
    if (this.ended) return;
    this.clock += dtMs;
    const prev = this.state;
    const next = stateAt(this.timeline, this.clock);
    this.state = next;
    if (next.subtitleKey !== prev.subtitleKey) this.hooks.onSubtitle(next.subtitle);
    for (let i = prev.delivered; i < next.delivered; i++) this.hooks.onOps(this.timeline.demo[i].ops, i);
    if (next.sketch.key !== prev.sketch.key) this.hooks.onSketch?.(next.sketch);
    if (this.clock >= this.timeline.duration) { this.ended = true; this.hooks.onEnd(); }
  }

  /** Moves the clock to `ms` (clamped to the demo). The result depends only on `ms`, never on where the clock was. */
  seek(ms: number) {
    const prev = this.state;
    this.clock = clampTime(this.timeline, ms);
    const next = stateAt(this.timeline, this.clock);
    this.state = next;
    if (next.delivered !== prev.delivered) this.hooks.onJump?.(opsUpTo(this.timeline, next.delivered), next.delivered);
    this.hooks.onSubtitle(next.subtitle);
    this.hooks.onSketch?.(next.sketch);
    const wasEnded = this.ended;
    this.ended = this.clock >= this.timeline.duration;
    if (this.ended && !wasEnded) this.hooks.onEnd();
  }
}
