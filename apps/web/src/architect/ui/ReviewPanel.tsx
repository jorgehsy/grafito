import { useState } from "react";
import type { Finding, Review } from "@grafito/board";
import type { WaPillar } from "@grafito/contract";
import { listedFindings, reviewStats } from "../review";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";

interface Props {
  review: Review;
  open: boolean;
  onOpen(open: boolean): void;
  /** A turn is in flight: the buttons that send one wait. */
  busy: boolean;
  /** There is a design to review (at least one turn). */
  canRun: boolean;
  /** The label of the board item a finding is about; null when it has none or the item is gone. */
  targetLabel(target: string | undefined): string | null;
  /** The finding pointed at on the board; null for none. */
  selected: string | null;
  onSelect(id: string | null): void;
  /** Asks the architect for a pillar review (a turn). */
  onRun(): void;
  /** Asks the architect to fix a finding (a turn). */
  onFix(f: Finding): void;
}

const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7.5 2.8v5.6c0 4.6-3 8-7.5 9.6-4.5-1.6-7.5-5-7.5-9.6V5.8z" />
    <path d="M8.8 12.2l2.3 2.3 4.3-4.6" />
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);

/**
 * The Well-Architected review beside the board: the six pillars with how the design stands on each, and the open
 * findings, worst first. Clicking a finding points at its item on the board; clicking a pillar shows only its
 * findings. The button at the top opens and closes it and counts the open findings.
 */
export function ReviewPanel({ review, open, onOpen, busy, canRun, targetLabel, selected, onSelect, onRun, onFix }: Props) {
  const t = useT();
  const [pillar, setPillar] = useState<WaPillar | null>(null);
  const stats = reviewStats(review);
  const empty = !stats.assessed && !review.findings.length;
  const listed = listedFindings(review, pillar);
  const resolved = review.findings.filter((f) => !f.open);
  const pillarName = (p: WaPillar) => t(`architect.pillar.${p}` as MessageKey);
  const run = (
    <button type="button" className="pbtn primary" data-testid="review-run" disabled={busy || !canRun} title={canRun ? undefined : t("architect.review.needDesign")} onClick={onRun}>
      {t(empty ? "architect.review.run" : "architect.review.rerun")}
    </button>
  );

  return (
    <>
      <button
        type="button" className={"review-toggle inst" + (open ? " on" : "")} data-testid="review-toggle" aria-expanded={open} aria-controls="review-panel"
        title={t(open ? "architect.review.hide" : "architect.review.show")} onClick={() => onOpen(!open)}
      >
        <IconShield />
        <span>{t("architect.review.toggle")}</span>
        {stats.open > 0 && <b className={"rv-count sev-" + stats.worst} data-testid="review-count" aria-label={t("architect.review.openCount", { count: stats.open })}>{stats.open}</b>}
      </button>
      {open && (
        <aside className="review inst" id="review-panel" data-testid="review-panel" aria-label={t("architect.review.title")}>
          <header>
            <div className="rv-head">
              <span className="ttl">{t("architect.review.title")}</span>
              {!empty && <span className="rv-sub" data-testid="review-summary">{t("architect.review.summary", { assessed: stats.assessed, total: stats.pillars.length })} · {t("architect.review.openCount", { count: stats.open })}</span>}
            </div>
            <button type="button" className="x" aria-label={t("architect.review.hide")} title={t("architect.review.hide")} onClick={() => onOpen(false)}><IconClose /></button>
          </header>

          {empty ? (
            <div className="rv-empty" data-testid="review-empty">
              <p>{t("architect.review.empty")}</p>
              {run}
            </div>
          ) : (
            <>
              <ul className="rv-pillars" aria-label={t("architect.review.pillars")}>
                {stats.pillars.map((p) => (
                  <li key={p.pillar}>
                    <button
                      type="button" className={"rv-pillar st-" + (p.status ?? "none") + (pillar === p.pillar ? " on" : "")} data-testid={`review-pillar-${p.pillar}`}
                      aria-pressed={pillar === p.pillar} title={t("architect.review.filter", { pillar: pillarName(p.pillar) })}
                      onClick={() => setPillar((cur) => (cur === p.pillar ? null : p.pillar))}
                    >
                      <i className="rv-dot" aria-hidden="true" />
                      <span className="rv-name">{pillarName(p.pillar)}</span>
                      <span className="rv-status">{t(`architect.review.status.${p.status ?? "none"}` as MessageKey)}</span>
                      {p.findings > 0 && <b className="rv-n" aria-label={t("architect.review.openCount", { count: p.findings })}>{p.findings}</b>}
                    </button>
                    {p.note && <p className="rv-note">{p.note}</p>}
                  </li>
                ))}
              </ul>

              <div className="rv-bar">
                <span className="rv-label">{pillar ? t("architect.review.findingsOf", { pillar: pillarName(pillar) }) : t("architect.review.findings")}</span>
                {(["high", "medium", "low"] as const).map((s) => (
                  <span key={s} className={"rv-chip sev-" + s + (stats.bySeverity[s] ? "" : " zero")} data-testid={`review-sev-${s}`}>
                    {stats.bySeverity[s]} {t(`architect.review.severity.${s}` as MessageKey)}
                  </span>
                ))}
              </div>

              {listed.length ? (
                <ol className="rv-findings" data-testid="review-findings">
                  {listed.map(({ n, finding: f }) => {
                    const label = targetLabel(f.target);
                    return (
                      <li key={f.id} className={"rv-finding sev-" + f.severity + (selected === f.id ? " on" : "")} data-testid={`finding-${f.id}`}>
                        <button
                          type="button" className="rv-main" aria-pressed={selected === f.id}
                          title={label ? t("architect.review.point", { target: label }) : t("architect.review.whole")}
                          onClick={() => onSelect(selected === f.id ? null : f.id)}
                        >
                          <span className="rv-tags">
                            <b className="rv-num" aria-hidden="true">{n}</b>
                            <span className="rv-sev">{t(`architect.review.severity.${f.severity}` as MessageKey)}</span>
                            <span className="rv-pil">{pillarName(f.pillar)}</span>
                          </span>
                          <span className="rv-text">{f.text}</span>
                          <span className="rv-meta">
                            <span className={"rv-target" + (label ? "" : " none")}>{label ?? (f.target ? t("architect.review.gone") : t("architect.review.whole"))}</span>
                            {f.bestPractice && <code title={t("architect.review.practice")}>{f.bestPractice}</code>}
                          </span>
                        </button>
                        <button type="button" className="pbtn rv-fix" data-testid={`finding-fix-${f.id}`} disabled={busy} onClick={() => onFix(f)}>{t("architect.review.fix")}</button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="rv-none" data-testid="review-none">{t(pillar ? "architect.review.nonePillar" : "architect.review.none")}</p>
              )}

              {resolved.length > 0 && (
                <details className="rv-resolved" data-testid="review-resolved">
                  <summary>{t("architect.review.resolved", { count: resolved.length })}</summary>
                  <ul>
                    {resolved.map((f) => <li key={f.id}><s>{f.text}</s></li>)}
                  </ul>
                </details>
              )}

              <footer>
                {run}
                <small>{t("architect.review.source")}</small>
              </footer>
            </>
          )}
        </aside>
      )}
    </>
  );
}
