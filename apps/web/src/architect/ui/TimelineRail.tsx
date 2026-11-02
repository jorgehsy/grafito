import type { BubbleMarker, BubbleView } from "../bubbles";
import { isOpen } from "../bubbles";
import { useT } from "../../i18n";

interface Props {
  markers: readonly BubbleMarker[];
  view: BubbleView;
  /** A marker was clicked: reopen that turn's bubble, or close it again. */
  onMarker(turn: number): void;
  /** The rail itself was clicked: show or hide every past bubble. */
  onRail(): void;
}

/**
 * The slim timeline rail above the text box: one bubble marker per turn. Hovering or focusing a marker shows its
 * text; clicking it reopens that bubble. Clicking the rail itself, or its label, shows or hides all past bubbles.
 */
export function TimelineRail({ markers, view, onMarker, onRail }: Props) {
  const t = useT();
  if (!markers.length) return null;
  const railLabel = t(view.showPast ? "architect.rail.hideAll" : "architect.rail.showAll");
  return (
    <div className={"trail" + (view.showPast ? " open" : "")} data-testid="timeline-rail" role="group" aria-label={t("architect.rail.label")} title={railLabel} onClick={onRail}>
      <button type="button" className="lbl" data-testid="rail-toggle" aria-pressed={view.showPast} aria-label={railLabel} onClick={(e) => { e.stopPropagation(); onRail(); }}>
        {t("architect.rail.label")}
      </button>
      {markers.map((m) => {
        const label = m.bubble
          ? t("architect.rail.marker", { n: m.turn, text: m.bubble.text })
          : m.error ? t("architect.rail.failed", { n: m.turn, error: m.error }) : t("architect.rail.silent", { n: m.turn });
        const open = !!m.bubble && isOpen(view, m.turn);
        return (
          <button
            key={m.turn}
            type="button"
            className={"rmarker" + (open ? " on" : "") + (m.bubble ? "" : " muted") + (m.turn === view.current ? " now" : "")}
            data-testid="bubble-marker"
            data-turn={m.turn}
            aria-label={label}
            aria-pressed={m.bubble ? open : undefined}
            aria-disabled={m.bubble ? undefined : true}
            onClick={(e) => { e.stopPropagation(); if (m.bubble) onMarker(m.turn); }}
          >
            <i />
            <span className="tip" aria-hidden="true">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
