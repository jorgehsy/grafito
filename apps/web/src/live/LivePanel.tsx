import { useEffect, useMemo, useRef, useState } from "react";
import { IconBars, IconClose, IconDoc, IconExport, IconGear, IconImport, IconMic, IconStop, IconTrash, IconUndo, IconWand, IconWave } from "../ui/icons";
import type { BoardController } from "@grafito/board";
import type { Subtitle } from "@grafito/board";
import { createLiveSession } from "./session";
import { lastUndoable } from "./session";
import type { LogEntry, Totals } from "./session";
import { fmtUsd, zeroUsage } from "@grafito/contract";
import { buildRecord, clearLocal, entriesFromRecord, isRecord, loadLocal, median, newSessionId, postRecord, replayOps, saveLocal } from "./record";
import type { SessionRecord } from "./record";
import { boardSvgText, download } from "./exporter";

import { WebSpeechSource } from "./speech/webSpeech";
import { createMicLock } from "./speech/micLock";
import { createGrouper } from "./speech/grouper";
import { ShapeGallery, SHAPE_OPTIONS } from "./ShapeGallery";
import { CatalogTiles, LangTiles, ModelTiles, ViewTiles } from "./OptionTiles";
import { loadCatalogs, saveCatalogs } from "./catalogs";
import { getLang, isLang, LANGS, setLang, useLang, useT } from "../i18n";
import type { SpeechSource, SpeechState } from "./speech/types";

const MODEL_OPTIONS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const tok = (n: number) => n.toLocaleString(getLang());

interface Props {
  getCtrl(): BoardController | null;
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

const hhmm = (t: number) => new Date(t).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit", hour12: false });
const readStats = () => { try { return localStorage.getItem("grafito.stats") !== "0"; } catch { return true; } };

export function LivePanel({ getCtrl, onSubtitle, onClear, active, onMode, modeLocked, follow, onFollow, summary, warnings, showTranscript, onShowTranscript }: Props) {
  const t = useT();
  const lang = useLang();
  const [statsOpen, setStatsOpen] = useState(readStats);
  const [optsOpen, setOptsOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const optsRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [current, setCurrent] = useState<LogEntry | null>(null);
  const [totals, setTotals] = useState<Totals>({ requests: 0, usage: zeroUsage(), costUsd: 0 });
  const [shape, setShape] = useState("auto");
  const shapeRef = useRef(shape);
  const [catalogs, setCatalogs] = useState<string[]>(loadCatalogs);
  const catalogsRef = useRef(catalogs);
  const modelRef = useRef(model);
  const spoken = useRef<string[]>([]);
  const [mic, setMic] = useState<{ state: SpeechState; detail?: string }>({ state: "idle" });
  const speech = useRef<SpeechSource | null>(null);
  const voiceAt = useRef<number | null>(null);
  const sid = useRef(newSessionId());
  const startedAt = useRef(Date.now());
  const transcript = useRef<{ text: string; at: number }[]>([]);
  const [saveWarn, setSaveWarn] = useState("");
  const [pending, setPending] = useState<SessionRecord | null>(() => { const r = loadLocal(); return r && r.requests.length ? r : null; });
  const fileIn = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const langRef = useRef(lang);
  const latest = useRef<{ entries: LogEntry[]; totals: Totals; busy: boolean }>({ entries: [], totals: { requests: 0, usage: zeroUsage(), costUsd: 0 }, busy: false });
  langRef.current = lang;
  modelRef.current = model;
  shapeRef.current = shape;
  catalogsRef.current = catalogs;

  const makeRecord = () =>
    buildRecord(
      { id: sid.current, startedAt: startedAt.current, model: modelRef.current, shape: shapeRef.current, lang: langRef.current, transcript: transcript.current, summary: getCtrl()?.board.summary ?? "" },
      latest.current.entries, latest.current.totals,
    );
  const saveNow = async () => {
    if (!dirty.current || !latest.current.entries.length) return;
    dirty.current = false;
    const rec = makeRecord();
    saveLocal(rec);
    const err = await postRecord(rec);
    setSaveWarn(err ? t("save.failed", { error: err }) : "");
    if (!err) setSavedAt(Date.now());
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function flushSoon() {
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { void saveRef.current(); }, 300);
  }
  useEffect(() => { // while there is activity, every ~10 s
    const t = setInterval(() => { if (latest.current.busy || dirty.current) void saveRef.current(); }, 10_000);
    return () => { clearInterval(t); clearTimeout(flushTimer.current); };
  }, []);

  const session = useMemo(
    () =>
      createLiveSession({
        getBoard: () => getCtrl()!.board,
        submit: (ops) => getCtrl()!.submit(ops),
        getModel: () => modelRef.current,
        getLang: () => langRef.current,
        getShape: () => shapeRef.current,
        getCatalogs: () => catalogsRef.current,
        getVoiceAt: () => { const v = voiceAt.current; voiceAt.current = null; return v; },
        onLog: (e, c, t) => { latest.current.entries = e; latest.current.totals = t; dirty.current = true; setEntries(e); setCurrent(c); setTotals(t); if (!c) flushSoon(); },
        onBusy: (b) => { latest.current.busy = b; setBusy(b); },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session is created once; callbacks read current values through refs
    [],
  );
  useEffect(() => { (window as any).__live = session; return () => { speech.current?.stop(); session.stop(); }; }, [session]);

  const grouper = useMemo(
    () => createGrouper((t, at) => { voiceAt.current = at; session.onFragment(t); }),
    [session],
  );
  const [micOn, setMicOn] = useState(false);

  const toggleMic = () => {
    if (speech.current) { // stop
      const cur = speech.current; speech.current = null; setMicOn(false);
      cur.stop(); grouper.flush();
      onSubtitle({ spoken: [...spoken.current], current: "" });
      return;
    }
    const src = new WebSpeechSource(lang);
    if (!src.available) { setMic({ state: "error", detail: t("speech.unavailable") }); return; }
    src.onInterim = (t) => onSubtitle({ spoken: [...spoken.current], current: t, interim: true });
    src.onFinal = (t) => { spoken.current.push(t); transcript.current.push({ text: t, at: Date.now() }); dirty.current = true; onSubtitle({ spoken: [...spoken.current], current: "" }); grouper.push(t); };
    src.onState = (state, detail) => {
      setMic({ state, detail });
      if (state === "error" || state === "idle") { if (speech.current === src) { speech.current = null; setMicOn(false); } if (state === "error") grouper.flush(); }
    };
    speech.current = src; setMicOn(true);
    micLock.current?.claim();
    src.start();
  };
  // Typed text (no microphone) enters like a speech result and closes the turn, as stopping the mic does.
  const [typed, setTyped] = useState("");
  const sendTyped = () => {
    const t = typed.trim();
    if (!t || !activeRef.current) return;
    spoken.current.push(t); transcript.current.push({ text: t, at: Date.now() }); dirty.current = true;
    onSubtitle({ spoken: [...spoken.current], current: "" });
    grouper.push(t); grouper.flush();
    setTyped("");
  };
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;
  // another tab claimed the mic: release it here and warn
  const micLock = useRef<ReturnType<typeof createMicLock> | null>(null);
  useEffect(() => {
    micLock.current = createMicLock(() => {
      if (!speech.current) return;
      toggleMicRef.current();
      setMic({ state: "error", detail: t("speech.micTaken") });
    });
    return () => { micLock.current?.close(); micLock.current = null; };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!activeRef.current || e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName))) return;
      e.preventDefault();
      toggleMicRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => { try { localStorage.setItem("grafito.stats", statsOpen ? "1" : "0"); } catch { /* storage unavailable */ } }, [statsOpen]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F3") { e.preventDefault(); setStatsOpen((v) => !v); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (!optsOpen) return;
    const down = (e: MouseEvent) => {
      const n = e.target as Node;
      if (optsRef.current?.contains(n) || gearRef.current?.contains(n)) return;
      setOptsOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOptsOpen(false); gearRef.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [optsOpen]);

  useEffect(() => { if (!active && speech.current) toggleMicRef.current(); }, [active]);

  const clear = () => {
    grouper.cancel();
    session.reset();
    spoken.current = [];
    transcript.current = [];
    sid.current = newSessionId(); startedAt.current = Date.now(); dirty.current = false;
    clearLocal(); setPending(null); setSaveWarn("");
    onClear();
  };

  const restore = (rec: SessionRecord) => {
    grouper.cancel();
    onClear(); // empty board; then every op is replayed at once (the queue switches to fast mode)
    const { entries: es, totals: t } = entriesFromRecord(rec);
    session.restore(es, t);
    latest.current.entries = es; latest.current.totals = t;
    sid.current = rec.id; startedAt.current = rec.startedAt;
    transcript.current = rec.transcript.map((x) => ({ ...x }));
    spoken.current = rec.transcript.map((x) => x.text);
    onSubtitle({ spoken: [...spoken.current], current: "" });
    if (rec.model && MODEL_OPTIONS.includes(rec.model)) setModel(rec.model);
    if (rec.shape && SHAPE_OPTIONS.some((o) => o.value === rec.shape)) setShape(rec.shape);
    if (isLang(rec.lang)) setLang(rec.lang);
    setPending(null);
    void getCtrl()?.submit(replayOps(es));
  };
  const canUndo = !busy && !!lastUndoable(entries);
  const undo = () => {
    if (!session.undoLastInstruction()) return;
    onClear(); // the board is rebuilt without the instruction; the log and transcript are kept
    void getCtrl()?.submit(replayOps(latest.current.entries));
  };
  const exportAll = () => {
    const rec = makeRecord();
    const base = `grafito_${rec.id}`;
    download(base + ".json", JSON.stringify(rec, null, 2), "application/json");
    const svg = boardSvgText();
    if (svg) download(base + ".svg", svg, "image/svg+xml");
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const rec = JSON.parse(await f.text());
      if (!isRecord(rec)) throw new Error(t("import.notRecord"));
      restore(rec);
    } catch (e: any) {
      setSaveWarn(t("import.failed", { error: e?.message ?? e }));
    }
    if (fileIn.current) fileIn.current.value = "";
  };

  const cur = current ?? entries[entries.length - 1] ?? null;
  const avg = totals.requests ? totals.costUsd / totals.requests : 0;
  const tu = totals.usage;
  const voiceMed = median(entries.filter((e) => e.voiceFirstMs !== null).map((e) => e.voiceFirstMs as number));
  const listening = mic.state === "listening";

  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? lang;

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
        <button className="tb" data-testid="undo" aria-label={t("toolbar.undo")} title={t("toolbar.undo")} disabled={!canUndo} onClick={undo}><IconUndo /></button>
        <button className="tb" data-testid="export" aria-label={t("toolbar.export")} title={t("toolbar.exportTitle")} disabled={!entries.length} onClick={exportAll}><IconExport /></button>
        <button className="tb" data-testid="clear" aria-label={t("toolbar.clear")} title={t("toolbar.clearTitle")} disabled={!active} onClick={clear}><IconTrash /></button>
        <hr />
        <button ref={gearRef} className={"tb" + (optsOpen ? " on" : "")} aria-pressed={optsOpen} aria-expanded={optsOpen} aria-label={t("toolbar.options")} title={t("toolbar.options")} onClick={() => setOptsOpen((v) => !v)}><IconGear /></button>
        <button className={"tb" + (statsOpen ? " on" : "")} aria-pressed={statsOpen} aria-label={t("toolbar.stats")} title={t("toolbar.statsTitle")} onClick={() => setStatsOpen((v) => !v)}><IconBars /></button>
      </nav>

      <div className="popover" ref={optsRef} role="dialog" aria-label={t("toolbar.options")} hidden={!optsOpen}>
        <div className="field">
          {t("options.model")}
          <ModelTiles value={model} onChange={setModel} />
        </div>
        <div className="field">
          {t("options.shape")}
          <ShapeGallery value={shape} onChange={setShape} />
        </div>
        <div className="field">
          {t("options.icons")}
          <CatalogTiles value={catalogs} onChange={(v) => { setCatalogs(v); saveCatalogs(v); }} />
        </div>
        <div className="field">
          {t("options.language")}
          <LangTiles value={lang} onChange={(v) => { if (isLang(v)) setLang(v); }} disabled={micOn} />
        </div>
        <div className="field">
          {t("options.view")}
          <ViewTiles follow={follow} onFollow={onFollow} showTranscript={showTranscript} onShowTranscript={onShowTranscript} />
        </div>
      </div>

      {active && (
        <form className="typebar" data-testid="typebar" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
          <input data-testid="type-input" aria-label={t("typebar.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("typebar.placeholder")} />
          <button className="pbtn primary" type="submit" disabled={!typed.trim()}>{t("typebar.send")}</button>
        </form>
      )}

      <div className="toasts">
        {active && pending && (
          <div className="toast" data-testid="restore-banner">
            {t("restore.banner", { count: pending.requests.length, cost: fmtUsd(pending.totals?.costUsd ?? 0) })}
            <button className="pbtn" onClick={() => restore(pending)}>{t("restore.restore")}</button>
            <button className="pbtn" onClick={() => { clearLocal(); setPending(null); }}>{t("restore.discard")}</button>
          </div>
        )}
        {saveWarn && <div className="toast warn" data-testid="save-warn" role="alert">{saveWarn}</div>}
        {mic.state === "error" && <div className="toast warn" data-testid="mic-error" role="alert">{mic.detail ?? t("mic.error")}</div>}
        {mic.state === "restarting" && <div className="toast" role="status">{t("mic.reconnecting")}{mic.detail ? ` (${mic.detail})` : ""}</div>}
      </div>

      {statsOpen && (
        <aside className="stats" aria-label={t("toolbar.stats")}>
          <header>
            <span className="ttl">{t("stats.title")}</span>
            <kbd>F3</kbd>
            <button className="x" aria-label={t("stats.close")} title={t("stats.closeTitle")} onClick={() => setStatsOpen(false)}><IconClose /></button>
          </header>
          <div className="grid" data-testid="meter">
            <div><span>{t("stats.model")}</span><b>{model.replace("claude-", "")}</b></div>
            <div><span>{t("stats.voiceLatency")}</span><b className="acc" data-testid="voice-latency">{voiceMed === null ? "—" : voiceMed + " ms"}</b></div>
            <div><span>{t("stats.requestTokens")}{busy ? t("stats.inProgress") : ""}</span><b>{cur ? t("stats.tokens", { input: tok(cur.usage.input_tokens), output: (cur.usageEstimated ? "≈" : "") + tok(cur.usage.output_tokens) }) : "—"}</b></div>
            <div><span>{t("stats.sessionTokens")}</span><b>{t("stats.tokens", { input: tok(tu.input_tokens), output: tok(tu.output_tokens) })}</b></div>
            <div><span>{t("stats.cache")}</span><b>{tok(tu.cache_read_input_tokens)} / {tok(tu.cache_creation_input_tokens)}</b></div>
            <div><span>{t("stats.cost")}</span><b>{cur ? (cur.usageEstimated ? "≈" : "") + fmtUsd(cur.costUsd) : "—"} · {fmtUsd(totals.costUsd)} · {t("stats.perRequest", { cost: fmtUsd(avg) })}</b></div>
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
                  {t("stats.timings", { firstOp: e.firstOpMs ?? "—", voice: e.voiceFirstMs ?? "—", total: e.totalMs ?? "…", ops: e.ops, input: e.usage.input_tokens, cache: e.usage.cache_read_input_tokens, output: (e.usageEstimated ? "≈" : "") + e.usage.output_tokens, cost: fmtUsd(e.costUsd) })}
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
      )}

      <div className="corner">{listening && <span className="dot" />}{listening ? t("mic.listening") + " · " : ""}{langLabel}{savedAt ? ` · ${t("corner.saved", { time: hhmm(savedAt) })}` : ""}</div>
    </div>
  );
}
