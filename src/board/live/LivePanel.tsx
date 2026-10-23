import { useEffect, useMemo, useRef, useState } from "react";
import { IconBars, IconClose, IconDoc, IconExport, IconGear, IconImport, IconMic, IconStop, IconUndo, IconWand, IconWave } from "../ui/icons";
import type { BoardController } from "../controller";
import type { Subtitle } from "../player";
import { SCRIPTS } from "../scripts";
import { createLiveSession } from "./session";
import { lastUndoable } from "./session";
import type { LogEntry, Totals } from "./session";
import { startDictation } from "./dictation";
import { fmtUsd, zeroUsage } from "./pricing";
import { buildRecord, clearLocal, entriesFromRecord, isRecord, loadLocal, median, newSessionId, postRecord, replayOps, saveLocal } from "./record";
import type { SessionRecord } from "./record";
import { boardSvgText, download } from "./exporter";

import { WebSpeechSource, UNAVAILABLE_MESSAGE } from "./speech/webSpeech";
import { createMicLock, MIC_TAKEN_MESSAGE } from "./speech/micLock";
import { createGrouper } from "./speech/grouper";
import { SPEECH_LANGS } from "./speech/types";
import type { SpeechSource, SpeechState } from "./speech/types";

const MODEL_OPTIONS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const SHAPE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "mindmap", label: "Mapa (mindmap)" },
  { value: "flow", label: "Flujo (flow)" },
  { value: "scale", label: "Escala (scale)" },
  { value: "cycle", label: "Ciclo (cycle)" },
  { value: "tree", label: "Árbol (tree)" },
  { value: "timeline", label: "Línea de tiempo (timeline)" },
  { value: "system", label: "Sistema (system)" },
  { value: "list", label: "Lista (list)" },
  { value: "compare", label: "Comparar (compare)" },
];
const tok = (n: number) => n.toLocaleString("es");
const scriptText = (id: string) => SCRIPTS.find((s) => s.id === id)?.script.map((c) => c.text).join(" ") ?? "";

interface Props {
  getCtrl(): BoardController | null;
  onSubtitle(s: Subtitle): void;
  onClear(): void;
  /** Modo "Claude en vivo": los controles de voz, importar, exportar y opciones solo funcionan aquí. */
  active: boolean;
  onMode(m: "script" | "claude"): void;
  modeLocked: boolean;
  follow: boolean;
  onFollow(v: boolean): void;
  summary: string;
  warnings: string[];
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
const readStats = () => { try { return localStorage.getItem("grafito.stats") !== "0"; } catch { return true; } };

export function LivePanel({ getCtrl, onSubtitle, onClear, active, onMode, modeLocked, follow, onFollow, summary, warnings }: Props) {
  const [statsOpen, setStatsOpen] = useState(readStats);
  const [optsOpen, setOptsOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const optsRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [interval, setIntervalMs] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [current, setCurrent] = useState<LogEntry | null>(null);
  const [totals, setTotals] = useState<Totals>({ requests: 0, usage: zeroUsage(), costUsd: 0 });
  const [shape, setShape] = useState("auto");
  const shapeRef = useRef(shape);
  const modelRef = useRef(model);
  const intervalRef = useRef(interval);
  const dict = useRef<{ stop(): void } | null>(null);
  const spoken = useRef<string[]>([]);
  const [lang, setLang] = useState("es-CL");
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
  const langRef = useRef("es-CL");
  const latest = useRef<{ entries: LogEntry[]; totals: Totals; busy: boolean }>({ entries: [], totals: { requests: 0, usage: zeroUsage(), costUsd: 0 }, busy: false });
  langRef.current = lang;
  modelRef.current = model;
  shapeRef.current = shape;
  intervalRef.current = interval;

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
    setSaveWarn(err ? `No se pudo guardar en pruebas/ (${err}); queda copia en el navegador.` : "");
    if (!err) setSavedAt(Date.now());
  };
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function flushSoon() {
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { void saveRef.current(); }, 300);
  }
  useEffect(() => { // mientras hay actividad, cada ~10 s
    const t = setInterval(() => { if (latest.current.busy || dirty.current) void saveRef.current(); }, 10_000);
    return () => { clearInterval(t); clearTimeout(flushTimer.current); };
  }, []);

  const session = useMemo(
    () =>
      createLiveSession({
        getBoard: () => getCtrl()!.board,
        submit: (ops) => getCtrl()!.submit(ops),
        getModel: () => modelRef.current,
        getShape: () => shapeRef.current,
        getVoiceAt: () => { const v = voiceAt.current; voiceAt.current = null; return v; },
        onLog: (e, c, t) => { latest.current.entries = e; latest.current.totals = t; dirty.current = true; setEntries(e); setCurrent(c); setTotals(t); if (!c) flushSoon(); },
        onBusy: (b) => { latest.current.busy = b; setBusy(b); },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => { (window as any).__live = session; return () => { dict.current?.stop(); speech.current?.stop(); session.stop(); }; }, [session]);

  // Punto de entrada de texto final (la voz se conectará aquí).
  const onFinalText = (t: string) => {
    spoken.current.push(t);
    transcript.current.push({ text: t, at: Date.now() });
    onSubtitle({ spoken: [...spoken.current], current: "" });
    session.onFinalText(t);
  };

  const grouper = useMemo(
    () => createGrouper((t, at) => { voiceAt.current = at; session.onFinalText(t); }),
    [session],
  );
  const [micOn, setMicOn] = useState(false);

  const toggleMic = () => {
    if (speech.current) { // detener
      const cur = speech.current; speech.current = null; setMicOn(false);
      cur.stop(); grouper.flush();
      onSubtitle({ spoken: [...spoken.current], current: "" });
      return;
    }
    const src = new WebSpeechSource(lang);
    if (!src.available) { setMic({ state: "error", detail: UNAVAILABLE_MESSAGE }); return; }
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
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;
  // otra pestaña reclamó el mic: soltarlo aquí y avisar
  const micLock = useRef<ReturnType<typeof createMicLock> | null>(null);
  useEffect(() => {
    micLock.current = createMicLock(() => {
      if (!speech.current) return;
      toggleMicRef.current();
      setMic({ state: "error", detail: MIC_TAKEN_MESSAGE });
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

  useEffect(() => { try { localStorage.setItem("grafito.stats", statsOpen ? "1" : "0"); } catch { /* sin almacenamiento */ } }, [statsOpen]);
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

  const sendAll = () => { if (text.trim()) onFinalText(text.trim()); };
  const simulate = () => {
    if (!text.trim() || dictating) return;
    setDictating(true);
    dict.current = startDictation(text, () => intervalRef.current, onFinalText, () => setDictating(false));
  };
  const stop = () => { dict.current?.stop(); grouper.cancel(); setDictating(false); session.stop(); };
  const clear = () => {
    dict.current?.stop(); setDictating(false); grouper.cancel();
    session.reset();
    spoken.current = [];
    transcript.current = [];
    sid.current = newSessionId(); startedAt.current = Date.now(); dirty.current = false;
    clearLocal(); setPending(null); setSaveWarn("");
    onClear();
  };

  const restore = (rec: SessionRecord) => {
    dict.current?.stop(); setDictating(false); grouper.cancel();
    onClear(); // tablero vacío; después se reponen todas las operaciones de golpe (la cola pasa a modo rápido)
    const { entries: es, totals: t } = entriesFromRecord(rec);
    session.restore(es, t);
    latest.current.entries = es; latest.current.totals = t;
    sid.current = rec.id; startedAt.current = rec.startedAt;
    transcript.current = rec.transcript.map((x) => ({ ...x }));
    spoken.current = rec.transcript.map((x) => x.text);
    onSubtitle({ spoken: [...spoken.current], current: "" });
    if (rec.model && MODEL_OPTIONS.includes(rec.model)) setModel(rec.model);
    if (rec.shape && SHAPE_OPTIONS.some((o) => o.value === rec.shape)) setShape(rec.shape);
    if (rec.lang && SPEECH_LANGS.some((l) => l.code === rec.lang)) setLang(rec.lang);
    setPending(null);
    void getCtrl()?.submit(replayOps(es));
  };
  const canUndo = !busy && !!lastUndoable(entries);
  const undo = () => {
    if (!session.undoLastInstruction()) return;
    onClear(); // se repone el tablero sin la instrucción; el registro y la transcripción se conservan
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
      if (!isRecord(rec)) throw new Error("no es un registro de grafito");
      restore(rec);
    } catch (e: any) {
      setSaveWarn("No se pudo importar: " + (e?.message ?? e));
    }
    if (fileIn.current) fileIn.current.value = "";
  };

  const cur = current ?? entries[entries.length - 1] ?? null;
  const avg = totals.requests ? totals.costUsd / totals.requests : 0;
  const tu = totals.usage;
  const voiceMed = median(entries.filter((e) => e.voiceFirstMs !== null).map((e) => e.voiceFirstMs as number));
  const listening = mic.state === "listening";
  const micLabel = mic.state === "listening" ? "Escuchando…" : mic.state === "restarting" ? "Reconectando…" : mic.state === "error" ? (mic.detail ?? "Error") : "";

  const lang_label = SPEECH_LANGS.find((l) => l.code === lang)?.label ?? lang;

  return (
    <div className="live" data-testid="live-panel">
      <nav className="toolbar" aria-label="Controles">
        <button className={"tb" + (micOn ? " on" : "")} data-testid="mic" aria-pressed={micOn} aria-label={micOn ? "Detener" : "Hablar"} title={micOn ? "Detener (barra espaciadora)" : "Hablar (barra espaciadora)"} disabled={!active} onClick={toggleMic}>
          {micOn ? <IconStop /> : <IconMic />}
        </button>
        <button className="tb" data-testid="import" aria-label="Importar" title="Importar sesión" disabled={!active} onClick={() => fileIn.current?.click()}><IconImport /></button>
        <input ref={fileIn} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        <hr />
        <button className={"tb mode" + (active ? " sel" : "")} aria-pressed={active} aria-label="Modo Claude en vivo" title="Claude en vivo" disabled={modeLocked} onClick={() => onMode("claude")}><IconWave /></button>
        <button className={"tb mode" + (!active ? " sel" : "")} aria-pressed={!active} aria-label="Modo Guion" title="Guion (sin Claude)" disabled={modeLocked} onClick={() => onMode("script")}><IconDoc /></button>
        <hr />
        <button className="tb" data-testid="undo" aria-label="Deshacer instrucción" title="Deshacer instrucción" disabled={!canUndo} onClick={undo}><IconUndo /></button>
        <button className="tb" data-testid="export" aria-label="Exportar" title="Exportar JSON y SVG" disabled={!entries.length} onClick={exportAll}><IconExport /></button>
        <hr />
        <button ref={gearRef} className={"tb" + (optsOpen ? " on" : "")} aria-pressed={optsOpen} aria-expanded={optsOpen} aria-label="Opciones" title="Opciones" onClick={() => setOptsOpen((v) => !v)}><IconGear /></button>
        <button className={"tb" + (statsOpen ? " on" : "")} aria-pressed={statsOpen} aria-label="Estadísticas" title="Estadísticas (F3)" onClick={() => setStatsOpen((v) => !v)}><IconBars /></button>
      </nav>

      <div className="popover" ref={optsRef} role="dialog" aria-label="Opciones" hidden={!optsOpen}>
        <label className="field">
          Modelo
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">
          Forma del dibujo
          <select data-testid="shape" value={shape} onChange={(e) => setShape(e.target.value)}>
            {SHAPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="voice" data-testid="voice">
          <label className="field">
            Idioma
            <select value={lang} disabled={micOn} onChange={(e) => setLang(e.target.value)}>
              {SPEECH_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <div className={"micstate" + (mic.state === "error" ? " err" : "")} data-testid="mic-state" role="status">
            {listening && <span className="dot" />}{micLabel || "Pulsa Hablar o la barra espaciadora."}
            {mic.state === "restarting" && mic.detail ? ` (${mic.detail})` : ""}
          </div>
        </div>
        <label className="field">
          Usar texto de un guion
          <select value="" onChange={(e) => { if (e.target.value) setText(scriptText(e.target.value)); }}>
            <option value="">— elegir —</option>
            {SCRIPTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <textarea data-testid="live-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe o pega aquí lo que se va a dictar…" />
        <div className="row wrap">
          <button className="pbtn primary" onClick={sendAll} disabled={!active || !text.trim()}>Enviar todo</button>
          <button className="pbtn" onClick={simulate} disabled={!active || !text.trim() || dictating}>Simular dictado</button>
          <button className="pbtn" onClick={stop} disabled={!dictating && !busy}>Detener</button>
          <button className="pbtn" onClick={clear} disabled={!active}>Limpiar</button>
        </div>
        <label className="field">
          Intervalo de dictado: {interval} ms
          <input type="range" min={500} max={4000} step={100} value={interval} onChange={(e) => setIntervalMs(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => onFollow(e.target.checked)} /> Seguir cámara
        </label>
      </div>

      <div className="toasts">
        {active && pending && (
          <div className="toast" data-testid="restore-banner">
            Hay una prueba sin cerrar ({pending.requests.length} peticiones, {fmtUsd(pending.totals?.costUsd ?? 0)})
            <button className="pbtn" onClick={() => restore(pending)}>Restaurar</button>
            <button className="pbtn" onClick={() => { clearLocal(); setPending(null); }}>Descartar</button>
          </div>
        )}
        {saveWarn && <div className="toast warn" data-testid="save-warn" role="alert">{saveWarn}</div>}
        {mic.state === "error" && <div className="toast warn" data-testid="mic-error" role="alert">{mic.detail ?? "Error de voz"}</div>}
        {mic.state === "restarting" && <div className="toast" role="status">Reconectando el micrófono…{mic.detail ? ` (${mic.detail})` : ""}</div>}
      </div>

      {statsOpen && (
        <aside className="stats" aria-label="Estadísticas">
          <header>
            <span className="ttl">ESTADÍSTICAS</span>
            <kbd>F3</kbd>
            <button className="x" aria-label="Cerrar estadísticas" title="Cerrar" onClick={() => setStatsOpen(false)}><IconClose /></button>
          </header>
          <div className="grid" data-testid="meter">
            <div><span>Modelo</span><b>{model.replace("claude-", "")}</b></div>
            <div><span>Voz → 1.ª figura</span><b className="acc" data-testid="voice-latency">{voiceMed === null ? "—" : voiceMed + " ms"}</b></div>
            <div><span>Tokens petición{busy ? " (en curso)" : ""}</span><b>{cur ? <>{tok(cur.usage.input_tokens)} in · {cur.usageEstimated ? "≈" : ""}{tok(cur.usage.output_tokens)} out</> : "—"}</b></div>
            <div><span>Tokens sesión</span><b>{tok(tu.input_tokens)} in · {tok(tu.output_tokens)} out</b></div>
            <div><span>Caché leída / escrita</span><b>{tok(tu.cache_read_input_tokens)} / {tok(tu.cache_creation_input_tokens)}</b></div>
            <div><span>Costo</span><b>{cur ? (cur.usageEstimated ? "≈" : "") + fmtUsd(cur.costUsd) : "—"} · {fmtUsd(totals.costUsd)} · {fmtUsd(avg)}/pet.</b></div>
          </div>
          <div className="log" data-testid="live-log">
            {entries.slice().reverse().map((e) => (
              <div key={e.id} className={"logrow" + (e.error ? " err" : "")}>
                <div>
                  <time>{hhmm(e.startedAt)}</time> <b>#{e.id}</b>{" "}
                  {e.mode === "instruction" && <span className="tag"><IconWand /> instrucción:</span>}{" "}
                  {e.model.replace("claude-", "")} · “{e.delta.length > 60 ? e.delta.slice(0, 60) + "…" : e.delta}”
                </div>
                <div className="dim">
                  1.ª op {e.firstOpMs ?? "—"} ms · voz→1.ª figura {e.voiceFirstMs ?? "—"} ms · total {e.totalMs ?? "…"} ms · {e.ops} ops · in {e.usage.input_tokens} / caché {e.usage.cache_read_input_tokens} / out {e.usageEstimated ? "≈" : ""}{e.usage.output_tokens} · {fmtUsd(e.costUsd)}
                </div>
                {e.mode === "instruction" && (e.undone ? <div className="dim">deshecha</div> : e.done && !e.error && <div className="dim">aplicada ({e.ops} cambios)</div>)}
                {e.warnings.map((w, i) => <div key={i} className="lwarn">{w}</div>)}
                {e.error && <div className="lwarn">{e.error}</div>}
              </div>
            ))}
          </div>
          {summary && <div className="sum"><b>Resumen:</b> {summary}</div>}
          {warnings.length > 0 && <div className="warns">{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
        </aside>
      )}

      <div className="corner">{listening && <span className="dot" />}{listening ? "Escuchando · " : ""}{lang_label}{savedAt ? ` · guardado ${hhmm(savedAt)}` : ""}</div>
    </div>
  );
}
