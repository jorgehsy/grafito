// The drawing dock: hand, pen and eraser, the inks, and the button that hands the sketch to Claude.
import type { CSSProperties, ReactNode } from "react";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n";
import { AUTO_READ_MS, INKS } from "./useSketch";
import type { SketchControl } from "./useSketch";

function Ico({ children }: { children: ReactNode }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
const IconHand = () => <Ico><path d="M8 12.5V5.6a1.6 1.6 0 0 1 3.2 0V11M11.2 10.5V4.1a1.6 1.6 0 0 1 3.2 0v6.6M14.4 11V5.9a1.6 1.6 0 0 1 3.2 0v8.3c0 4-2.5 6.8-6.3 6.8-2.6 0-4.1-1.1-5.5-3.2L3.6 14a1.6 1.6 0 0 1 2.6-1.8L8 14.4" /></Ico>;
const IconPencil = ({ tip }: { tip: string }) => (
  <Ico>
    <path d="M4 20l1.2-4.6L16.4 4.2a1.7 1.7 0 0 1 2.4 0l1 1a1.7 1.7 0 0 1 0 2.4L8.6 18.8z" />
    <path d="M14.6 6l3.4 3.4" />
    <path d="M4 20l1.2-4.6 3.4 3.4z" fill={tip} stroke={tip} />
  </Ico>
);
const IconEraser = () => <Ico><path d="M8.5 19.5h11M6.2 18.3l-2.5-2.5a1.7 1.7 0 0 1 0-2.4l9-9a1.7 1.7 0 0 1 2.4 0l4.5 4.5a1.7 1.7 0 0 1 0 2.4l-8.2 8.2H7.4z" /><path d="M9.3 8.8l6 6" /></Ico>;
const IconBack = () => <Ico><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Ico>;
const IconSweep = () => <Ico><path d="M14 4l6 6M12.5 5.5L4 14c-1 1-1 3 .2 4.2L5.8 20h5l7.7-7.5" /><path d="M9 20h11" /></Ico>;
const IconSpark = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M11 2.5c.5 4.6 2.4 6.5 7 7-4.6.5-6.5 2.4-7 7-.5-4.6-2.4-6.5-7-7 4.6-.5 6.5-2.4 7-7z" />
    <path d="M18.5 14.5c.25 2.3 1.2 3.25 3.5 3.5-2.3.25-3.25 1.2-3.5 3.5-.25-2.3-1.2-3.25-3.5-3.5 2.3-.25 3.25-1.2 3.5-3.5z" />
  </svg>
);

const RING = 2 * Math.PI * 19;

export function DrawDock({ sketch }: { sketch: SketchControl }) {
  const t = useT();
  const { tool, color, pending, reading, dueAt, kept } = sketch;
  const status = reading ? t("draw.reading") : kept ? t("draw.kept") : pending && !sketch.auto ? t("draw.pending", { count: pending }) : "";
  // The ring restarts with every new deadline; it starts part-way if this render came late.
  const elapsed = dueAt === null ? 0 : Math.max(0, AUTO_READ_MS - (dueAt - performance.now()));
  const ringStyle = { animationDuration: `${AUTO_READ_MS}ms`, animationDelay: `-${Math.round(elapsed)}ms` } as CSSProperties;
  return (
    <div className="drawdock" role="toolbar" aria-label={t("draw.dock")} data-testid="draw-dock">
      <div className="dd-row">
        <div className="dd-group" role="group" aria-label={t("draw.tools")}>
          <button className={"dd-btn" + (tool === "pan" ? " on" : "")} data-testid="tool-pan" aria-pressed={tool === "pan"} aria-label={t("draw.pan")} title={t("draw.panTitle")} onClick={() => sketch.setTool("pan")}><IconHand /><kbd>V</kbd></button>
          <button className={"dd-btn" + (tool === "pen" ? " on" : "")} data-testid="tool-pen" aria-pressed={tool === "pen"} aria-label={t("draw.pen")} title={t("draw.penTitle")} onClick={() => sketch.setTool("pen")}><IconPencil tip={tool === "pen" && color === INKS[0].color ? "currentColor" : color} /><kbd>P</kbd></button>
          <button className={"dd-btn" + (tool === "eraser" ? " on" : "")} data-testid="tool-eraser" aria-pressed={tool === "eraser"} aria-label={t("draw.eraser")} title={t("draw.eraserTitle")} onClick={() => sketch.setTool("eraser")}><IconEraser /><kbd>E</kbd></button>
        </div>
        <i className="dd-sep" />
        <div className="dd-group dd-inks" role="radiogroup" aria-label={t("draw.color")}>
          {INKS.map((ink) => (
            <button key={ink.id} className={"dd-ink" + (color === ink.color ? " on" : "")} role="radio" aria-checked={color === ink.color} data-testid={`ink-${ink.id}`}
              aria-label={t(`draw.ink.${ink.id}` as MessageKey)} title={t(`draw.ink.${ink.id}` as MessageKey)} style={{ "--ink": ink.color } as CSSProperties}
              onClick={() => { sketch.setColor(ink.color); if (tool !== "pen") sketch.setTool("pen"); }}><i /></button>
          ))}
        </div>
        <i className="dd-sep" />
        <div className="dd-group">
          <button className="dd-btn" data-testid="draw-undo" aria-label={t("draw.undo")} title={t("draw.undoTitle")} disabled={!sketch.mine} onClick={sketch.undo}><IconBack /></button>
          <button className="dd-btn" data-testid="draw-clear" aria-label={t("draw.clear")} title={t("draw.clearTitle")} disabled={!sketch.mine} onClick={sketch.clear}><IconSweep /></button>
        </div>
        <i className="dd-sep" />
        <div className="dd-group dd-read">
          <button className={"dd-spark" + (reading ? " busy" : "") + (pending ? " ready" : "")} data-testid="draw-read" aria-label={t("draw.read")} title={t("draw.readTitle")} disabled={!pending || reading} onClick={sketch.read}>
            <svg className="dd-ring" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="19" className="track" />
              {dueAt !== null && !reading && <circle key={dueAt} cx="22" cy="22" r="19" className="run" strokeDasharray={RING} style={ringStyle} />}
              {reading && <circle cx="22" cy="22" r="19" className="spin" strokeDasharray={`${RING * 0.28} ${RING}`} />}
            </svg>
            <IconSpark />
            {pending > 0 && !reading && <b className="dd-count" aria-hidden="true">{pending}</b>}
          </button>
          <label className={"dd-auto" + (sketch.auto ? " on" : "")} title={t("draw.autoTitle")}>
            <input type="checkbox" data-testid="draw-auto" checked={sketch.auto} onChange={(e) => sketch.setAuto(e.target.checked)} />
            <span className="sw" aria-hidden="true"><i /></span>
            {t("draw.auto")}
          </label>
        </div>
      </div>
      <div className={"dd-status" + (status ? " show" : "") + (reading ? " busy" : "")} role="status" data-testid="draw-status">{status}</div>
    </div>
  );
}

/** The empty board's invitation in live mode: three ways in. */
export function StartHint() {
  const t = useT();
  return (
    <div className="starthint" data-testid="start-hint">
      <svg className="sh-mark" width="150" height="46" viewBox="0 0 150 46" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 30c10-18 20-20 26-8s14 12 22-2 18-14 26-2 16 14 24 2 18-10 42-12" />
        <path d="M134 3l11 5-8 9" />
      </svg>
      <h2>{t("draw.start.title")}</h2>
      <ul>
        <li><b>{t("draw.start.talk")}</b><span>{t("draw.start.talkHow")}</span></li>
        <li><b>{t("draw.start.type")}</b><span>{t("draw.start.typeHow")}</span></li>
        <li><b>{t("draw.start.draw")}</b><span>{t("draw.start.drawHow")}</span></li>
      </ul>
    </div>
  );
}
