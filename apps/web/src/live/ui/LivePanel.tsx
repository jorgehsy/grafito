import { useEffect, useRef, useState } from "react";
import { IconBars, IconDoc, IconExport, IconGear, IconImport, IconMic, IconStop, IconTrash, IconUndo, IconWave } from "../../ui/icons";
import type { BoardController, Subtitle } from "@grafito/board";
import { fmtUsd, parseRecord } from "@grafito/contract";
import type { Settings } from "../session";
import { useLiveSession } from "./useLiveSession";
import { useMic } from "./useMic";
import { download } from "./download";
import { SHAPE_OPTIONS } from "./ShapeGallery";
import { OptionsPopover } from "./OptionsPopover";
import { hhmm, StatsPanel } from "./StatsPanel";
import { loadCatalogs, saveCatalogs } from "../catalogs";
import { isLang, LANGS, setLang, useLang, useT } from "../../i18n";
import { readFlag, writeFlag } from "../../storage";

const MODEL_OPTIONS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const STATS_KEY = "grafito.stats";

interface Props {
  getCtrl(): BoardController | null;
  /** The board as a standalone SVG file, or null if there is none. */
  exportSvg(): string | null;
  onSubtitle(s: Subtitle): void;
  onClear(): void;
  /** Live mode: the voice, import, export and options controls only work here. */
  active: boolean;
  onMode(m: "demo" | "live"): void;
  modeLocked: boolean;
  follow: boolean;
  onFollow(v: boolean): void;
  summary: string;
  warnings: string[];
  showTranscript: boolean;
  onShowTranscript(v: boolean): void;
}

export function LivePanel({ getCtrl, exportSvg, onSubtitle, onClear, active, onMode, modeLocked, follow, onFollow, summary, warnings, showTranscript, onShowTranscript }: Props) {
  const t = useT();
  const lang = useLang();
  const [statsOpen, setStatsOpen] = useState(() => readFlag(STATS_KEY, true));
  const [optsOpen, setOptsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [shape, setShape] = useState("auto");
  const [catalogs, setCatalogs] = useState<string[]>(loadCatalogs);
  const [importWarn, setImportWarn] = useState("");
  const [typed, setTyped] = useState("");

  const settings: Settings = { model, shape, catalogs, speechLang: lang };
  const [session, live] = useLiveSession(
    { get: () => getCtrl()!.board, submit: (ops) => getCtrl()!.submit(ops), clear: onClear },
    settings,
    (s) => {
      if (MODEL_OPTIONS.includes(s.model)) setModel(s.model);
      if (SHAPE_OPTIONS.some((o) => o.value === s.shape)) setShape(s.shape);
      if (isLang(s.speechLang)) setLang(s.speechLang);
    },
  );
  useEffect(() => { (window as any).__live = session; }, [session]);

  const spoken = useRef<string[]>([]);
  useEffect(() => {
    spoken.current = live.transcript.map((x) => x.text);
    onSubtitle({ spoken: [...spoken.current], current: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new transcript changes the subtitles
  }, [live.transcript]);

  const { micOn, mic, toggle: toggleMic } = useMic({
    lang, active,
    onFinal: (text, endOfTurn) => session.onFinalText(text, { endOfTurn }),
    onInterim: (text) => onSubtitle({ spoken: [...spoken.current], current: text, interim: !!text }),
  });

  // Typed text (no microphone) enters like a speech result and closes the turn, as stopping the mic does.
  const sendTyped = () => {
    const text = typed.trim();
    if (!text || !active) return;
    session.onFinalText(text, { endOfTurn: true });
    setTyped("");
  };

  useEffect(() => writeFlag(STATS_KEY, statsOpen), [statsOpen]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F3") { e.preventDefault(); setStatsOpen((v) => !v); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const clear = () => { session.reset(); setImportWarn(""); };
  const exportAll = () => {
    const rec = session.snapshot();
    const base = `grafito_${rec.id}`;
    download(base + ".json", JSON.stringify(rec, null, 2), "application/json");
    const svg = exportSvg();
    if (svg) download(base + ".svg", svg, "image/svg+xml");
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const p = parseRecord(JSON.parse(await f.text()));
      if (!p.ok) throw new Error(p.outdated ? t("record.outdated") : t("import.notRecord"));
      session.restore(p.record);
      setImportWarn("");
    } catch (e: any) {
      setImportWarn(t("import.failed", { error: e?.message ?? e }));
    }
    if (fileIn.current) fileIn.current.value = "";
  };

  const listening = mic.state === "listening";
  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? lang;
  const warn = importWarn || live.warning;

  return (
    <div className="live" data-testid="live-panel">
      <nav className="toolbar" aria-label={t("toolbar.label")}>
        <button className={"tb" + (micOn ? " on" : "")} data-testid="mic" aria-pressed={micOn} aria-label={micOn ? t("toolbar.mic.stop") : t("toolbar.mic.talk")} title={micOn ? t("toolbar.mic.stopTitle") : t("toolbar.mic.talkTitle")} disabled={!active} onClick={toggleMic}>
          {micOn ? <IconStop /> : <IconMic />}
        </button>
        <button className="tb" data-testid="import" aria-label={t("toolbar.import")} title={t("toolbar.importTitle")} disabled={!active} onClick={() => fileIn.current?.click()}><IconImport /></button>
        <input ref={fileIn} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        <hr />
        <button className={"tb mode" + (active ? " sel" : "")} aria-pressed={active} aria-label={t("toolbar.liveMode")} title={t("toolbar.liveModeTitle")} disabled={modeLocked} onClick={() => onMode("live")}><IconWave /></button>
        <button className={"tb mode" + (!active ? " sel" : "")} aria-pressed={!active} aria-label={t("toolbar.demoMode")} title={t("toolbar.demoModeTitle")} disabled={modeLocked} onClick={() => onMode("demo")}><IconDoc /></button>
        <hr />
        <button className="tb" data-testid="undo" aria-label={t("toolbar.undo")} title={t("toolbar.undo")} disabled={!live.canUndo} onClick={() => session.undoLastInstruction()}><IconUndo /></button>
        <button className="tb" data-testid="export" aria-label={t("toolbar.export")} title={t("toolbar.exportTitle")} disabled={!live.entries.length} onClick={exportAll}><IconExport /></button>
        <button className="tb" data-testid="clear" aria-label={t("toolbar.clear")} title={t("toolbar.clearTitle")} disabled={!active} onClick={clear}><IconTrash /></button>
        <hr />
        <button ref={gearRef} className={"tb" + (optsOpen ? " on" : "")} aria-pressed={optsOpen} aria-expanded={optsOpen} aria-label={t("toolbar.options")} title={t("toolbar.options")} onClick={() => setOptsOpen((v) => !v)}><IconGear /></button>
        <button className={"tb" + (statsOpen ? " on" : "")} aria-pressed={statsOpen} aria-label={t("toolbar.stats")} title={t("toolbar.statsTitle")} onClick={() => setStatsOpen((v) => !v)}><IconBars /></button>
      </nav>

      <OptionsPopover
        open={optsOpen} anchor={gearRef} onClose={() => setOptsOpen(false)}
        model={model} onModel={setModel} shape={shape} onShape={setShape}
        catalogs={catalogs} onCatalogs={(v) => { setCatalogs(v); saveCatalogs(v); }}
        langLocked={micOn} follow={follow} onFollow={onFollow} showTranscript={showTranscript} onShowTranscript={onShowTranscript}
      />

      {active && (
        <form className="typebar" data-testid="typebar" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
          <input data-testid="type-input" aria-label={t("typebar.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("typebar.placeholder")} />
          <button className="pbtn primary" type="submit" disabled={!typed.trim()}>{t("typebar.send")}</button>
        </form>
      )}

      <div className="toasts">
        {active && live.unclosed && (
          <div className="toast" data-testid="restore-banner">
            {t("restore.banner", { count: live.unclosed.requests.length, cost: fmtUsd(live.unclosed.totals.costUsd) })}
            <button className="pbtn" onClick={() => live.unclosed && session.restore(live.unclosed)}>{t("restore.restore")}</button>
            <button className="pbtn" onClick={clear}>{t("restore.discard")}</button>
          </div>
        )}
        {warn && <div className="toast warn" data-testid="save-warn" role="alert">{warn}</div>}
        {mic.state === "error" && <div className="toast warn" data-testid="mic-error" role="alert">{mic.detail ?? t("mic.error")}</div>}
        {mic.state === "restarting" && <div className="toast" role="status">{t("mic.reconnecting")}{mic.detail ? ` (${mic.detail})` : ""}</div>}
      </div>

      {statsOpen && <StatsPanel session={live} model={model} summary={summary} warnings={warnings} onClose={() => setStatsOpen(false)} />}

      <div className="corner">{listening && <span className="dot" />}{listening ? t("mic.listening") + " · " : ""}{langLabel}{live.savedAt ? ` · ${t("corner.saved", { time: hhmm(live.savedAt) })}` : ""}</div>
    </div>
  );
}
