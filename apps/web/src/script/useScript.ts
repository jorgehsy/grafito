// Demo mode's player, as a hook: which demo is loaded, the transport (play, pause, seek, chapters, speed),
// the keyboard shortcuts and the wiring to the board. BoardApp owns the board; this owns the playback.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, applyArchitectOp, applyOp, demoTimeline, nextChapterTime, prevChapterTime } from "@grafito/board";
import type { BoardController, DemoTimeline, Subtitle } from "@grafito/board";
import type { Engine } from "../render/engine";
import { spacePan } from "../render/spacePan";
import type { SketchStore } from "../sketch/store";
import { BUILT_IN, sourceFromRecordText } from "./source";
import type { ScriptSource } from "./source";
import { createScriptSketch } from "./sketchStore";

export type ScriptStatus = "idle" | "playing" | "paused" | "done";
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** How far the timeline's own arrow keys move. */
export const NUDGE_MS = 5000;

interface Deps {
  /** Demo mode is on: shortcuts work and the demo's sketch is the one on the board. */
  active: boolean;
  getCtrl(): BoardController | null;
  getEngine(): Engine | null;
  /** The app's own sketch, put back on the board when demo mode ends. */
  appSketch: SketchStore;
  /** Empties the board, the canvas and the subtitles. */
  resetBoard(): void;
  onSubtitle(s: Subtitle): void;
}

export interface ScriptControl {
  sources: ScriptSource[];
  source: ScriptSource;
  timeline: DemoTimeline;
  status: ScriptStatus;
  /** The player's clock in ms, refreshed a few times a second while playing. */
  clock: number;
  speed: number;
  /** Playing or paused: the app mode cannot change. */
  locked: boolean;
  /** The last problem opening a session, or a note about the one playing; "" if none. */
  notice: string;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Back to the start card, with an empty board. */
  restart(): void;
  /** Stops playback without touching the board (the caller is about to reset it). */
  stop(): void;
  seek(ms: number): void;
  prevChapter(): void;
  nextChapter(): void;
  /** While scrubbing the clock stands still, so the playhead stays under the pointer. */
  scrub(on: boolean): void;
  setSpeed(v: number): void;
  cycleSpeed(): void;
  /** Loads a demo or an opened session and plays it. */
  select(id: string): void;
  /** Opens a saved session file as a replay and plays it. */
  openFile(file: File | undefined): Promise<void>;
  dismissNotice(): void;
}

const param = (name: string) => new URLSearchParams(location.search).get(name);
const isTyping = (el: HTMLElement | null) => !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function useScript(deps: Deps): ScriptControl {
  const d = useRef(deps);
  d.current = deps;
  const player = useRef<Player | null>(null);
  const statusRef = useRef<ScriptStatus>("idle");
  const scrubbing = useRef(false);
  const [sketch] = useState(createScriptSketch);

  const [opened, setOpened] = useState<ScriptSource | null>(null);
  const sources = useMemo(() => (opened ? [...BUILT_IN, opened] : BUILT_IN), [opened]);
  const [sourceId, setSourceId] = useState(() => { const id = param("demo"); return BUILT_IN.some((s) => s.id === id) ? id! : BUILT_IN[0].id; });
  const source = sources.find((s) => s.id === sourceId) ?? BUILT_IN[0];
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const timeline = useMemo(() => demoTimeline(source.demo), [source]);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  const [status, setStatusState] = useState<ScriptStatus>("idle");
  const [clock, setClock] = useState(0);
  const shownClock = useRef(0);
  const [speed, setSpeedState] = useState(() => Number(param("speed")) || 1);
  const speedRef = useRef(speed);
  const [notice, setNotice] = useState("");

  const setStatus = useCallback((s: ScriptStatus) => { statusRef.current = s; setStatusState(s); }, []);
  const showClock = useCallback((ms: number) => { shownClock.current = ms; setClock(ms); }, []);

  const stop = useCallback(() => {
    player.current = null;
    sketch.show(null);
    d.current.getEngine()?.setReading([]);
    showClock(0);
    setStatus("idle");
  }, [sketch, showClock, setStatus]);

  /** A player on an empty board, for the loaded source. */
  const load = useCallback(() => {
    stop();
    d.current.resetBoard();
    const src = sourceRef.current;
    const apply = src.architect ? applyArchitectOp : applyOp;
    const p = new Player(src.demo, {
      onSubtitle: (s) => d.current.onSubtitle(s),
      onOps: (ops) => { void d.current.getCtrl()?.submit(ops, apply); },
      onEnd: () => { if (player.current === p) setStatus("done"); },
      onSketch: (frame) => { sketch.show(frame); d.current.getEngine()?.setReading(frame.reading); },
      // The old picture stays up until the new one is laid out, then it is swapped in one frame.
      onJump: (ops) => { void d.current.getCtrl()?.jump(ops, apply, () => d.current.getEngine()?.reset()); },
    });
    player.current = p;
    return p;
  }, [stop, sketch, setStatus]);

  const play = useCallback(() => {
    if (statusRef.current === "playing") return;
    if (statusRef.current !== "paused" || !player.current || player.current.done) load();
    d.current.getEngine()?.setPaused(false);
    setStatus("playing");
  }, [load, setStatus]);

  const pause = useCallback(() => {
    if (statusRef.current !== "playing") return;
    d.current.getEngine()?.setPaused(true);
    setStatus("paused");
  }, [setStatus]);

  const toggle = useCallback(() => { if (statusRef.current === "playing") pause(); else play(); }, [play, pause]);

  const restart = useCallback(() => { stop(); d.current.resetBoard(); }, [stop]);

  const seek = useCallback((ms: number) => {
    const p = player.current ?? load();
    // From the start card or the end, a seek shows that moment and waits for Play.
    if (statusRef.current === "idle" || statusRef.current === "done") {
      d.current.getEngine()?.setPaused(true);
      setStatus("paused");
    }
    p.seek(ms);
    // A seek to the very end is the end: unlock the modes, and Play starts over.
    if (p.done) setStatus("done");
    showClock(p.clock);
  }, [load, setStatus, showClock]);

  const prevChapter = useCallback(() => seek(prevChapterTime(timelineRef.current, player.current?.clock ?? 0)), [seek]);
  const nextChapter = useCallback(() => seek(nextChapterTime(timelineRef.current, player.current?.clock ?? 0)), [seek]);
  const scrub = useCallback((on: boolean) => { scrubbing.current = on; }, []);

  const setSpeed = useCallback((v: number) => { if (v > 0) setSpeedState(v); }, []);
  const cycleSpeed = useCallback(() => setSpeedState((v) => SPEEDS.find((s) => s > v) ?? SPEEDS[0]), []);
  useEffect(() => {
    speedRef.current = speed;
    const e = d.current.getEngine();
    if (e) e.userSpeed = speed;
  }, [speed]);

  /** Loads `src` and plays it from the start. */
  const start = useCallback((src: ScriptSource) => {
    sourceRef.current = src;
    timelineRef.current = demoTimeline(src.demo);
    setSourceId(src.id);
    setNotice(src.note);
    // A built-in demo has a link of its own.
    if (!src.replay) {
      const url = new URL(location.href);
      url.searchParams.set("demo", src.id);
      history.replaceState(history.state, "", url);
    }
    stop();
    play();
  }, [stop, play]);

  const select = useCallback((id: string) => {
    const src = [...BUILT_IN, ...(openedRef.current ? [openedRef.current] : [])].find((s) => s.id === id);
    if (src) start(src);
  }, [start]);

  const openedRef = useRef(opened);
  openedRef.current = opened;
  const openFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try { text = await file.text(); } catch (e) { setNotice(String(e instanceof Error ? e.message : e)); return; }
    const r = sourceFromRecordText(text);
    if (!r.ok) { setNotice(r.error); return; }
    openedRef.current = r.source;
    setOpened(r.source);
    start(r.source);
  }, [start]);

  // The clock: one frame at a time while playing; the readout follows a few times a second.
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      const p = player.current;
      if (!p) return;
      if (statusRef.current === "playing" && !scrubbing.current) p.tick(dt * speedRef.current);
      if (Math.abs(p.clock - shownClock.current) >= 100 || (p.done && shownClock.current !== p.clock)) showClock(p.clock);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [showClock]);

  // ?auto= plays on load. Its value may name the demo (the older form); otherwise ?demo= does.
  useEffect(() => {
    const auto = param("auto");
    if (!auto) return;
    const named = BUILT_IN.find((s) => s.id === auto);
    const timer = setTimeout(() => { if (named) start(named); else play(); }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // In demo mode the board shows the demo's sketch; outside it, the app's own.
  const { active, appSketch } = deps;
  useEffect(() => {
    if (!active) return;
    const engine = d.current.getEngine();
    engine?.setSketch(sketch);
    return () => { engine?.setReading([]); engine?.setSketch(appSketch); };
  }, [active, appSketch, sketch]);

  // Space plays and pauses (on release: held while dragging it pans the board); the arrows step chapters.
  useEffect(() => {
    if (!active) return;
    let spaceAt: number | null = null;
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (isTyping(el)) return;
      // The timeline has its own arrow keys; Space still plays and pauses from there.
      if (e.code !== "Space" && el?.closest?.("[data-own-keys]")) return;
      if (e.code === "Space") {
        // On a button, Space is that button's click.
        if (e.repeat || el?.tagName === "BUTTON") return;
        e.preventDefault();
        spacePan.used = false;
        spaceAt = performance.now();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        if (e.code === "ArrowLeft") prevChapter(); else nextChapter();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || spaceAt === null) return;
      const held = performance.now() - spaceAt;
      spaceAt = null;
      if (!spacePan.used && held < 600) toggle();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [active, toggle, prevChapter, nextChapter]);

  const dismissNotice = useCallback(() => setNotice(""), []);

  return {
    sources, source, timeline, status, clock, speed, locked: status === "playing" || status === "paused", notice,
    play, pause, toggle, restart, stop, seek, prevChapter, nextChapter, scrub, setSpeed, cycleSpeed, select, openFile, dismissNotice,
  };
}
