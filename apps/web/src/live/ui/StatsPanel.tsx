import { IconClose, IconWand } from "../../ui/icons";
import { fmtUsd } from "@grafito/contract";
import type { LiveSessionState } from "../session";
import { getLang, useT } from "../../i18n";

const tok = (n: number) => n.toLocaleString(getLang());
export const hhmm = (t: number) => new Date(t).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit", hour12: false });

interface Props {
  session: LiveSessionState;
  model: string;
  summary: string;
  warnings: string[];
  onClose(): void;
}

export function StatsPanel({ session: { entries, current, totals, busy, medianVoiceFirstMs: voiceMed }, model, summary, warnings, onClose }: Props) {
  const t = useT();
  const cur = current ?? entries[entries.length - 1] ?? null;
  const avg = totals.requests ? totals.costUsd / totals.requests : 0;
  const tu = totals.usage;
  return (
    <aside className="stats" aria-label={t("toolbar.stats")}>
      <header>
        <span className="ttl">{t("stats.title")}</span>
        <kbd>F3</kbd>
        <button className="x" aria-label={t("stats.close")} title={t("stats.closeTitle")} onClick={onClose}><IconClose /></button>
      </header>
      <div className="grid" data-testid="meter">
        <div><span>{t("stats.model")}</span><b>{model.replace("claude-", "")}</b></div>
        <div><span>{t("stats.voiceLatency")}</span><b className="acc" data-testid="voice-latency">{voiceMed === null ? "—" : voiceMed + " ms"}</b></div>
        <div><span>{t("stats.requestTokens")}{busy ? t("stats.inProgress") : ""}</span><b>{cur ? t("stats.tokens", { input: tok(cur.usage.input_tokens), output: (cur.usageEstimated ? "≈" : "") + tok(cur.usage.output_tokens) }) : "—"}</b></div>
        <div><span>{t("stats.sessionTokens")}</span><b>{t("stats.tokens", { input: tok(tu.input_tokens), output: tok(tu.output_tokens) })}</b></div>
        <div><span>{t("stats.cache")}</span><b>{tok(tu.cache_read_input_tokens)} / {tok(tu.cache_creation_input_tokens)}</b></div>
        <div><span>{t("stats.cost")}</span><b>{cur?.costUsd === null ? t("cost.included") : <>{cur ? (cur.usageEstimated ? "≈" : "") + fmtUsd(cur.costUsd) : "—"} · {fmtUsd(totals.costUsd)} · {t("stats.perRequest", { cost: fmtUsd(avg) })}</>}</b></div>
      </div>
      <div className="log" data-testid="live-log">
        {entries.slice().reverse().map((e) => (
          <div key={e.id} className={"logrow" + (e.error ? " err" : "")}>
            <div>
              <time>{hhmm(e.startedAt)}</time> <b>#{e.id}</b>{" "}
              {e.mode === "instruction" && <span className="tag"><IconWand /> {t("stats.instruction")}</span>}{" "}
              {e.model.replace("claude-", "")} · “{e.batch.length > 60 ? e.batch.slice(0, 60) + "…" : e.batch}”
            </div>
            <div className="dim">
              {t("stats.timings", { firstOp: e.firstOpMs ?? "—", voice: e.voiceFirstMs ?? "—", total: e.totalMs ?? "…", ops: e.ops, input: e.usage.input_tokens, cache: e.usage.cache_read_input_tokens, output: (e.usageEstimated ? "≈" : "") + e.usage.output_tokens, cost: e.costUsd === null ? t("cost.included") : fmtUsd(e.costUsd) })}
            </div>
            {e.mode === "instruction" && (e.undone ? <div className="dim">{t("stats.undone")}</div> : e.done && !e.error && <div className="dim">{t("stats.applied", { count: e.ops })}</div>)}
            {e.warnings.map((w, i) => <div key={i} className="lwarn">{w}</div>)}
            {e.error && <div className="lwarn">{e.error}</div>}
          </div>
        ))}
      </div>
      {summary && <div className="sum"><b>{t("stats.summary")}</b> {summary}</div>}
      {warnings.length > 0 && <div className="warns">{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
    </aside>
  );
}
