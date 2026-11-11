// Demo mode's player surface: the start card on the empty board, and the transport bar at the bottom
// (demo list, play and chapter steps, the timeline with its chapters, speed, open a saved session).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { chapterAt, clampTime, demoTimeline, formatClock } from "@grafito/board";
import { useT } from "../i18n";
import { IconChevron, IconClose, IconPause, IconPlay, IconRestart } from "../ui/icons";
import { NUDGE_MS } from "./useScript";
import type { ScriptControl } from "./useScript";

function Ico({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
const IconPrev = () => <Ico><path d="M6 5v14M19 5l-9 7 9 7z" /></Ico>;
const IconNext = () => <Ico><path d="M18 5v14M5 5l9 7-9 7z" /></Ico>;
const IconOpen = () => <Ico><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M10 13.5l2-2 2 2M12 11.5V16" /></Ico>;
const IconList = () => <Ico size={18}><path d="M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0" /></Ico>;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** The timeline: one segment per chapter, a playhead, click or drag to seek, arrows to nudge. */
function Timeline({ script }: { script: ScriptControl }) {
  const t = useT();
  const { timeline, clock } = script;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const pending = useRef<number | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // Another demo: what the pointer was over no longer means anything.
  useEffect(() => setHover(null), [timeline]);

  const duration = timeline.duration || 1;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clampTime(timeline, ((clientX - r.left) / (r.width || 1)) * duration);
  };
  /** At most one seek per frame while dragging. */
  const seekSoon = (ms: number) => {
    if (pending.current === null) raf.current = requestAnimationFrame(() => { const at = pending.current; pending.current = null; if (at !== null) script.seek(at); });
    pending.current = ms;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Capture keeps the drag alive outside the track; without it (no such pointer) a click still seeks.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    setDragging(true);
    script.scrub(true);
    script.seek(timeAt(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const at = timeAt(e.clientX);
    setHover(at);
    if (dragging) seekSoon(at);
  };
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    script.scrub(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const to: Record<string, () => void> = {
      ArrowLeft: () => script.seek(clock - NUDGE_MS),
      ArrowRight: () => script.seek(clock + NUDGE_MS),
      ArrowDown: () => script.seek(clock - NUDGE_MS),
      ArrowUp: () => script.seek(clock + NUDGE_MS),
      PageDown: script.prevChapter,
      PageUp: script.nextChapter,
      Home: () => script.seek(0),
      End: () => script.seek(timeline.duration),
    };
    const run = to[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  const now = chapterAt(timeline, clock);
  const chapter = now >= 0 ? timeline.chapters[now] : null;
  const pct = (ms: number) => `${(Math.min(duration, Math.max(0, ms)) / duration) * 100}%`;
  const hoverChapter = hover === null ? null : timeline.chapters[chapterAt(timeline, hover)] ?? null;
  const valueText = chapter
    ? t("script.positionChapter", { time: formatClock(clock), total: formatClock(timeline.duration), n: now + 1, count: timeline.chapters.length, title: chapter.title })
    : t("script.position", { time: formatClock(clock), total: formatClock(timeline.duration) });

  return (
    <div className="sp-time">
      <div className="sp-readout">
        <time data-testid="script-elapsed">{formatClock(clock)}</time>
        <span className="sp-chapter" data-testid="script-chapter" title={chapter?.title}>
          {chapter && <><b>{now + 1}/{timeline.chapters.length}</b> {chapter.title}</>}
        </span>
        <time data-testid="script-total">{formatClock(timeline.duration)}</time>
      </div>
      <div
        ref={ref} className={"sp-track" + (dragging ? " drag" : "")} role="slider" tabIndex={0} data-own-keys="" data-testid="script-timeline"
        aria-label={t("script.timeline")} aria-valuemin={0} aria-valuemax={Math.round(timeline.duration / 1000)} aria-valuenow={Math.round(clock / 1000)} aria-valuetext={valueText}
        onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onPointerLeave={() => setHover(null)} onKeyDown={key}
      >
        <div className="sp-segs">
          {timeline.chapters.map((ch) => {
            const span = ch.end - ch.start;
            const fill = Math.min(1, Math.max(0, (clock - ch.start) / (span || 1)));
            return (
              <span key={ch.index} className={"sp-seg" + (ch.index === now ? " now" : "") + (hoverChapter === ch ? " hover" : "")} style={{ flexGrow: span }} data-testid="script-chapter-mark">
                <i style={{ width: `${fill * 100}%` }} />
              </span>
            );
          })}
        </div>
        <span className="sp-thumb" style={{ left: pct(clock) }} />
        {hover !== null && (
          <span className="sp-tip" style={{ left: pct(hover) }} role="presentation">
            {hoverChapter && <b>{hoverChapter.title}</b>}
            <time>{formatClock(hover)}</time>
          </span>
        )}
      </div>
    </div>
  );
}

/** The demo list: name and one line each, plus the door to a saved session. */
function Picker({ script, onOpenFile, onClose }: { script: ScriptControl; onOpenFile(): void; onClose(): void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[aria-current=true]")?.focus(); }, []);
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const click = (e: MouseEvent) => { if (!(e.target as HTMLElement | null)?.closest?.(".sp-picker, .sp-source, [data-picker-toggle]")) onClose(); };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", click);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", click); };
  }, [onClose]);
  const timelines = useMemo(() => new Map(script.sources.map((s) => [s.id, demoTimeline(s.demo)])), [script.sources]);
  return (
    <div className="sp-picker slip" ref={ref} role="dialog" aria-label={t("script.picker")} data-testid="script-picker" data-own-keys="">
      <ul>
        {script.sources.map((s) => (
          <li key={s.id}>
            <button className={"sp-item" + (s.id === script.source.id ? " sel" : "")} aria-current={s.id === script.source.id} data-testid={`script-demo-${s.id}`} onClick={() => { script.select(s.id); onClose(); }}>
              <span className="sp-item-name">
                {s.name}
                {s.replay && <em>{t("script.session.badge")}</em>}
                {s.lang && <em>{s.lang}</em>}
              </span>
              <span className="sp-item-desc">{s.description}</span>
              <span className="sp-item-meta">{formatClock(timelines.get(s.id)!.duration)} · {t("script.chapters", { count: timelines.get(s.id)!.chapters.length })}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="sp-item sp-open" data-testid="script-open-session" onClick={() => { onOpenFile(); onClose(); }}>
        <IconOpen />
        <span>
          <span className="sp-item-name">{t("script.open")}</span>
          <span className="sp-item-desc">{t("script.openHow")}</span>
        </span>
      </button>
    </div>
  );
}

export function ScriptPlayer({ script }: { script: ScriptControl }) {
  const t = useT();
  const { status, source } = script;
  const [picking, setPicking] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const openFile = () => fileIn.current?.click();
  const closePicker = useCallback(() => setPicking(false), []);
  const playing = status === "playing";
  const playLabel = status === "paused" ? t("app.resume") : t("app.play");

  // A session file can be dropped on the bar or on the start card.
  const drop = {
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDropping(true); } },
    onDragLeave: () => setDropping(false),
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(false);
      void script.openFile(e.dataTransfer.files[0]);
    },
  };

  return (
    <>
      {status === "idle" && (
        <div className="sp-start" data-testid="script-start">
          <div className={"sp-card" + (dropping ? " dropping" : "")} {...drop}>
            <span className="sp-kicker">{source.replay ? t("script.session.badge") : t("app.demoBar")}</span>
            <h2>{source.name}</h2>
            <p>{source.description}</p>
            <button className="sp-bigplay" data-testid="script-start-play" onClick={script.play}>
              <IconPlay />
              <span>{t("app.play")}</span>
            </button>
            <p className="sp-hint">{t("app.demoHint")}</p>
            <p className="sp-keys"><kbd>{t("script.key.space")}</kbd> {t("script.key.spaceDoes")} <kbd>←</kbd> <kbd>→</kbd> {t("script.key.arrowsDo")}</p>
            <div className="sp-more">
              <button className="pbtn" data-picker-toggle="" data-testid="script-start-pick" onClick={() => setPicking((v) => !v)}>{t("script.otherDemos")}</button>
              <button className="pbtn" data-testid="script-start-open" onClick={openFile}>{t("script.open")}</button>
            </div>
          </div>
        </div>
      )}

      <div className={"sp-bar inst" + (dropping ? " dropping" : "")} role="group" aria-label={t("app.demoBar")} data-testid="script-bar" {...drop}>
        {script.notice && !picking && (
          <div className="sp-notice slip" role="status" data-testid="script-notice">
            <span>{script.notice}</span>
            <button className="tb sm" aria-label={t("script.dismiss")} title={t("script.dismiss")} onClick={script.dismissNotice}><IconClose /></button>
          </div>
        )}
        {dropping && <div className="sp-drop" aria-hidden="true">{t("script.drop")}</div>}
        {picking && <Picker script={script} onOpenFile={openFile} onClose={closePicker} />}

        <button className="sp-source" aria-haspopup="dialog" aria-expanded={picking} title={t("script.picker")} data-testid="script-source" onClick={() => setPicking((v) => !v)}>
          <IconList />
          <span>{source.name}</span>
          <IconChevron up={!picking} />
        </button>

        <div className="sp-buttons">
          <button className="tb sm" aria-label={t("script.prev")} title={t("script.prevTitle")} data-testid="script-prev" onClick={script.prevChapter}><IconPrev /></button>
          {playing ? (
            <button className="tb sm on" aria-label={t("app.pause")} title={t("script.pauseTitle")} data-testid="script-play" onClick={script.pause}><IconPause /></button>
          ) : (
            <button className="tb sm on" aria-label={playLabel} title={t("script.playTitle", { action: playLabel })} data-testid="script-play" onClick={script.play}><IconPlay /></button>
          )}
          <button className="tb sm" aria-label={t("script.next")} title={t("script.nextTitle")} data-testid="script-next" onClick={script.nextChapter}><IconNext /></button>
        </div>

        <Timeline script={script} />

        <div className="sp-buttons">
          <button className="sp-speed spd" aria-label={t("script.speed", { speed: script.speed })} title={t("script.speedTitle")} data-testid="script-speed" onClick={script.cycleSpeed}>{script.speed}x</button>
          <button className="tb sm" aria-label={t("app.restart")} title={t("app.restart")} data-testid="script-restart" disabled={status === "idle"} onClick={script.restart}><IconRestart /></button>
          <button className="tb sm" aria-label={t("script.open")} title={t("script.openHow")} data-testid="script-open" onClick={openFile}><IconOpen /></button>
        </div>
        <input ref={fileIn} type="file" accept="application/json,.json" hidden data-testid="script-file" onChange={(e) => { void script.openFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </>
  );
}
