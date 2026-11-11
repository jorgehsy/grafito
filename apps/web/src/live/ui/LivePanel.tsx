import { useEffect, useRef, useState } from "react";
import { IconBars, IconCompass, IconDoc, IconExport, IconGear, IconImport, IconMic, IconStop, IconTrash, IconUndo, IconWave } from "../../ui/icons";
import type { BoardController, Subtitle } from "@grafito/board";
import type { Engine } from "../../render/engine";
import type { SketchStore } from "../../sketch/store";
import { useSketch } from "../../sketch/useSketch";
import { DrawDock } from "../../sketch/DrawDock";
import type { SessionFactory } from "./useLiveSession";
import { isModelId, MODELS, parseRecord } from "@grafito/contract";
import type { ArchitectRecord } from "@grafito/contract";
import type { ArchitectRecordControl } from "../../architect/ui/ArchitectPanel";
import type { Settings } from "../session";
import { useLiveSession } from "./useLiveSession";
import { useMic } from "./useMic";
import { download } from "./download";
import { saveHifi } from "../../render/hifi/save";
import { SHAPE_OPTIONS } from "./ShapeGallery";
import { OptionsPopover } from "./OptionsPopover";
import { hhmm, StatsPanel } from "./StatsPanel";
import { loadCatalogs, saveCatalogs } from "../catalogs";
import { fetchAvailableModels, totalCost, usableModel } from "../models";
import type { ModelControl } from "../models";
import { isLang, LANGS, setLang, useLang, useT } from "../../i18n";
import { readFlag, writeFlag } from "../../storage";
import type { RoomClient, RoomState } from "../../room/client";
import { PresenceBar } from "../../room/ui/PresenceBar";
import { Feed } from "../../room/ui/Feed";
import { seedOps } from "../../room/start";

const STATS_KEY = "grafito.stats";

interface Props {
  getCtrl(): BoardController | null;
  getEngine(): Engine | null;
  /** The sketch people draw on the board: local when alone, the room's when in one. */
  sketch: SketchStore;
  /** Makes the session the panel talks to; absent = live mode's own. A room passes one that speaks to its socket. */
  createSession?: SessionFactory;
  /** Who draws here and in which ink, when a room says so. */
  me?: { id: string; color: string };
  /** The room this page is in (client and state are null until it connects); null when working alone. */
  room: { id: string; client: RoomClient | null; state: RoomState | null } | null;
  /** The board as a standalone SVG file, or null if there is none. */
  exportSvg(): string | null;
  onSubtitle(s: Subtitle): void;
  onClear(): void;
  /**
   * The app mode; null until it is known. The voice controls only work in live mode; import, export and clear in
   * live and architect mode; undo in live mode only.
   */
  mode: "demo" | "live" | "architect" | null;
  onMode(m: "demo" | "live" | "architect"): void;
  follow: boolean;
  onFollow(v: boolean): void;
  summary: string;
  warnings: string[];
  showTranscript: boolean;
  onShowTranscript(v: boolean): void;
  /** The mute control while the mic is on, null while it is off; shown next to the subtitles. */
  onMuteControl(c: { muted: boolean; toggle(): void } | null): void;
  /** Another mode's model choice (architect mode has its own); the options popover shows it instead of live mode's. */
  modelControl: ModelControl | null;
  /** Architect mode's session, while it is on: export, import and clear act on it. */
  architect: ArchitectRecordControl | null;
  /** Reopens an imported architect record in architect mode, switching to it if needed. */
  onOpenArchitect(rec: ArchitectRecord): void;
}

export function LivePanel({ getCtrl, getEngine, sketch, createSession, me, room, exportSvg, onSubtitle, onClear, mode, onMode, follow, onFollow, summary, warnings, showTranscript, onShowTranscript, onMuteControl, modelControl, architect, onOpenArchitect }: Props) {
  const t = useT();
  const lang = useLang();
  const active = mode === "live";
  // The architect session, when architect mode is on and its panel is mounted.
  const arch = mode === "architect" ? architect : null;
  const [statsOpen, setStatsOpen] = useState(() => readFlag(STATS_KEY, true));
  const [optsOpen, setOptsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState(MODELS[0].id);
  // Model ids the server offers; null until /api/health answers (and if it fails).
  const [available, setAvailable] = useState<string[] | null>(null);
  const availableRef = useRef(available);
  availableRef.current = available;
  const [shape, setShape] = useState("auto");
  const [catalogs, setCatalogs] = useState<string[]>(loadCatalogs);
  const [importWarn, setImportWarn] = useState("");
  const [typed, setTyped] = useState("");

  const settings: Settings = { model, shape, catalogs, speechLang: lang };
  const [session, live] = useLiveSession(
    { get: () => getCtrl()!.board, submit: (ops) => getCtrl()!.submit(ops), clear: onClear },
    settings,
    (s) => {
      if (isModelId(s.model)) setModel(usableModel(s.model, availableRef.current));
      if (SHAPE_OPTIONS.some((o) => o.value === s.shape)) setShape(s.shape);
      if (isLang(s.speechLang)) setLang(s.speechLang);
    },
    sketch,
    createSession,
  );
  const draw = useSketch({
    // In architect mode the same dock draws, and a sketch read is an architect turn.
    enabled: active || !!arch, getEngine, store: sketch, session: arch ?? session, author: me?.id, color: me?.color,
    getBoard: () => { const c = getCtrl(); return c ? { board: c.board, layout: c.layout } : null; },
  });
  useEffect(() => { (window as any).__live = session; }, [session]);

  useEffect(() => {
    let alive = true;
    void fetchAvailableModels().then((ids) => { if (alive) setAvailable(ids); });
    return () => { alive = false; };
  }, []);
  // A choice the server does not offer falls back to the default.
  useEffect(() => { setModel((m) => usableModel(m, available)); }, [available]);

  const spoken = useRef<string[]>([]);
  useEffect(() => {
    spoken.current = live.transcript.map((x) => x.text);
    onSubtitle({ spoken: [...spoken.current], current: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new transcript changes the subtitles
  }, [live.transcript]);

  const { micOn, muted, mic, toggle: toggleMic, toggleMute } = useMic({
    lang, active,
    onFinal: (text, endOfTurn) => session.onFinalText(text, { endOfTurn }),
    onInterim: (text) => onSubtitle({ spoken: [...spoken.current], current: text, interim: !!text }),
  });

  // Leaving live mode stops its session: a request still in flight must not draw on another mode's board.
  useEffect(() => { if (!active) session.stop(); }, [active, session]);

  useEffect(() => {
    onMuteControl(micOn ? { muted, toggle: toggleMute } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleMute reads current values through refs
  }, [micOn, muted]);

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

  const clear = () => {
    if (arch) arch.reset(); else session.reset();
    // the ink goes with the board (a room wipes its own sketch when it resets)
    const ink = room ? [] : sketch.strokes().map((s) => s.id);
    if (ink.length) sketch.remove(ink);
    setImportWarn("");
  };
  const exportAll = () => {
    const rec = arch ? arch.snapshot() : session.snapshot();
    const base = `grafito_${rec.id}`;
    download(base + ".json", JSON.stringify(rec, null, 2), "application/json");
    const svg = exportSvg();
    if (svg) download(base + ".svg", svg, "image/svg+xml");
    // the same board drawn clean, for a document or a slide: <id>.hifi.svg and <id>.hifi.png
    const c = getCtrl();
    if (c?.layout && c.board.zones.length) {
      void saveHifi(base + ".hifi", c.board, c.layout, {
        date: new Date().toLocaleDateString(lang, { dateStyle: "long" }),
        labels: { proposed: t("hifi.proposed"), one: t("hifi.endOne"), many: t("hifi.endMany"), pk: t("hifi.pk"), fk: t("hifi.fk"), madeWith: t("hifi.madeWith") },
      });
    }
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const p = parseRecord(JSON.parse(await f.text()));
      if (!p.ok) throw new Error(p.outdated ? t("record.outdated") : t("import.notRecord"));
      // A record reopens in its own app mode, switching the app to it.
      if (p.record.appMode === "architect") onOpenArchitect(p.record);
      else {
        if (!active) onMode("live");
        session.restore(p.record);
      }
      setImportWarn("");
    } catch (e: any) {
      setImportWarn(t("import.failed", { error: e?.message ?? e }));
    }
    if (fileIn.current) fileIn.current.value = "";
  };

  // In a room the other modes are a way out of it, and say so.
  const leaves = room ? ` · ${t("mode.leavesRoom")}` : "";
  const listening = mic.state === "listening";
  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? lang;
  const warn = importWarn || (arch ? "" : live.warning);
  const savedAt = arch ? arch.savedAt : live.savedAt;

  return (
    <div className="live" data-testid="live-panel">
      {/* the three app modes, by the brand: the selected one shows its name */}
      <nav className="modes" aria-label={t("mode.label")} data-testid="modes">
        <button className={"mode" + (active ? " sel" : "")} data-testid="mode-live" aria-pressed={active} aria-label={t("toolbar.liveMode")} title={t("toolbar.liveModeTitle")} onClick={() => onMode("live")}><IconWave /><span>{t("mode.live")}</span></button>
        <button className={"mode" + (mode === "demo" ? " sel" : "")} data-testid="mode-demo" aria-pressed={mode === "demo"} aria-label={t("toolbar.demoMode")} title={t("toolbar.demoModeTitle") + leaves} onClick={() => onMode("demo")}><IconDoc /><span>{t("mode.demo")}</span></button>
        <button className={"mode" + (mode === "architect" ? " sel" : "")} data-testid="mode-architect" aria-pressed={mode === "architect"} aria-label={t("toolbar.architectMode")} title={t("toolbar.architectModeTitle") + leaves} onClick={() => onMode("architect")}><IconCompass /><span>{t("mode.architect")}</span></button>
      </nav>
      <nav className="toolbar" aria-label={t("toolbar.label")}>
        <button className="tb" data-testid="import" aria-label={t("toolbar.import")} title={t("toolbar.importTitle")} disabled={(!active && !arch) || !!room} onClick={() => fileIn.current?.click()}><IconImport /></button>
        <input ref={fileIn} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        <hr />
        <button className="tb" data-testid="undo" aria-label={t("toolbar.undo")} title={t("toolbar.undo")} disabled={!active || !live.canUndo} onClick={() => session.undoLastInstruction()}><IconUndo /></button>
        <button className="tb" data-testid="export" aria-label={t("toolbar.export")} title={t("toolbar.exportTitle")} disabled={arch ? !arch.canExport : !live.entries.length} onClick={exportAll}><IconExport /></button>
        <button className="tb" data-testid="clear" aria-label={t("toolbar.clear")} title={t("toolbar.clearTitle")} disabled={!active && !arch} onClick={clear}><IconTrash /></button>
        <hr />
        <button ref={gearRef} className={"tb" + (optsOpen ? " on" : "")} aria-pressed={optsOpen} aria-expanded={optsOpen} aria-label={t("toolbar.options")} title={t("toolbar.options")} onClick={() => setOptsOpen((v) => !v)}><IconGear /></button>
        <button className={"tb" + (statsOpen && active ? " on" : "")} disabled={!active} aria-pressed={statsOpen && active} aria-label={t("toolbar.stats")} title={t("toolbar.statsTitle")} onClick={() => setStatsOpen((v) => !v)}><IconBars /></button>
      </nav>

      {(active || arch) && <DrawDock sketch={draw} />}

      {active && (
        <PresenceBar
          room={room?.client && room.state ? { client: room.client, state: room.state } : null}
          canCollaborate={!live.busy}
          seedOps={() => seedOps(session.snapshot())}
        />
      )}
      {active && room?.state && <Feed state={room.state} />}

      <OptionsPopover
        open={optsOpen} anchor={gearRef} onClose={() => setOptsOpen(false)}
        model={modelControl?.model ?? model} availableModels={modelControl ? modelControl.available : available} onModel={modelControl?.onModel ?? setModel} shape={shape} onShape={setShape}
        catalogs={catalogs} onCatalogs={(v) => { setCatalogs(v); saveCatalogs(v); }}
        langLocked={micOn} follow={follow} onFollow={onFollow} showTranscript={showTranscript} onShowTranscript={onShowTranscript}
        architect={mode === "architect"}
      />

      {active && (
        <form className="typebar" data-testid="typebar" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
          <button type="button" className={"micbtn" + (micOn ? " on" : "") + (listening && !muted ? " hot" : "")} data-testid="mic" aria-pressed={micOn} aria-label={micOn ? t("toolbar.mic.stop") : t("toolbar.mic.talk")} title={micOn ? t("toolbar.mic.stopTitle") : t("toolbar.mic.talkTitle")} onClick={toggleMic}>
            {micOn ? <IconStop /> : <IconMic />}
          </button>
          <input data-testid="type-input" aria-label={t("typebar.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("typebar.placeholder")} />
          <button className="pbtn primary" type="submit" disabled={!typed.trim()}>{t("typebar.send")}</button>
        </form>
      )}

      <div className="toasts">
        {active && !room && live.unclosed && (
          <div className="toast" data-testid="restore-banner">
            {t("restore.banner", { count: live.unclosed.requests.length, cost: totalCost(live.unclosed.requests.map((r) => r.model), live.unclosed.totals.costUsd, t("cost.included")) })}
            <button className="pbtn" onClick={() => live.unclosed && session.restore(live.unclosed)}>{t("restore.restore")}</button>
            <button className="pbtn" onClick={clear}>{t("restore.discard")}</button>
          </div>
        )}
        {warn && <div className="toast warn" data-testid="save-warn" role="alert">{warn}</div>}
        {mic.state === "error" && <div className="toast warn" data-testid="mic-error" role="alert">{mic.detail ?? t("mic.error")}</div>}
        {mic.state === "restarting" && <div className="toast" role="status">{t("mic.reconnecting")}{mic.detail ? ` (${mic.detail})` : ""}</div>}
      </div>

      {statsOpen && active && <StatsPanel session={live} model={model} summary={summary} warnings={warnings} onClose={() => setStatsOpen(false)} />}

      <div className="corner">{listening && <span className="dot" />}{listening ? t(muted ? "mic.muted" : "mic.listening") + " · " : ""}{langLabel}{savedAt ? ` · ${t("corner.saved", { time: hhmm(savedAt) })}` : ""}</div>
    </div>
  );
}
