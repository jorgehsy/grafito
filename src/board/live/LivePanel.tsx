import { useEffect, useMemo, useRef, useState } from "react";
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
}

export function LivePanel({ getCtrl, onSubtitle, onClear }: Props) {
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
    src.start();
  };
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName))) return;
      e.preventDefault();
      toggleMicRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

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

  return (
    <div className="live" data-testid="live-panel">
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
        <div className="row wrap">
          <button className={"primary micbtn" + (micOn ? " on" : "")} data-testid="mic" onClick={toggleMic}>
            {micOn ? "⏹ Detener" : "🎙️ Hablar"}
          </button>
          <select aria-label="Idioma" value={lang} disabled={micOn} onChange={(e) => setLang(e.target.value)}>
            {SPEECH_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className={"micstate" + (mic.state === "error" ? " err" : "")} data-testid="mic-state">
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
        <button className="primary" onClick={sendAll} disabled={!text.trim()}>Enviar todo</button>
        <button onClick={simulate} disabled={!text.trim() || dictating}>Simular dictado</button>
        <button onClick={stop} disabled={!dictating && !busy}>Detener</button>
        {canUndo && <button onClick={undo} data-testid="undo">↩ Deshacer instrucción</button>}
        <button onClick={clear}>Limpiar</button>
        <button onClick={exportAll} disabled={!entries.length} data-testid="export">Exportar</button>
        <button onClick={() => fileIn.current?.click()} data-testid="import">Importar</button>
        <input ref={fileIn} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
      </div>
      {pending && (
        <div className="restore" data-testid="restore-banner">
          Hay una prueba sin cerrar ({pending.requests.length} peticiones, {fmtUsd(pending.totals?.costUsd ?? 0)}) —{" "}
          <button onClick={() => restore(pending)}>Restaurar</button> <button onClick={() => { clearLocal(); setPending(null); }}>Descartar</button>
        </div>
      )}
      {saveWarn && <div className="warn savewarn" data-testid="save-warn">⚠ {saveWarn}</div>}
      <label className="field">
        Intervalo de dictado: {interval} ms
        <input type="range" min={500} max={4000} step={100} value={interval} onChange={(e) => setIntervalMs(Number(e.target.value))} />
      </label>

      <div className="meter" data-testid="meter">
        <div>
          <b>Petición{busy ? " (en curso)" : ""}</b>
          {cur ? (
            <> · entrada {tok(cur.usage.input_tokens)} · caché leída {tok(cur.usage.cache_read_input_tokens)} · caché escrita {tok(cur.usage.cache_creation_input_tokens)} · salida {cur.usageEstimated ? "≈" : ""}{tok(cur.usage.output_tokens)} · <b>{cur.usageEstimated ? "≈" : ""}{fmtUsd(cur.costUsd)}</b></>
          ) : " · —"}
        </div>
        <div>
          <b>Sesión</b> · {totals.requests} petición(es) · entrada {tok(tu.input_tokens)} · caché {tok(tu.cache_read_input_tokens)}/{tok(tu.cache_creation_input_tokens)} · salida {tok(tu.output_tokens)} · <b>{fmtUsd(totals.costUsd)}</b> · media {fmtUsd(avg)}/petición
        </div>
        <div data-testid="voice-latency"><b>voz→1.ª figura</b> · mediana {voiceMed === null ? "—" : voiceMed + " ms"}</div>
      </div>

      <div className="log" data-testid="live-log">
        {entries.slice().reverse().map((e) => (
          <div key={e.id} className={"logrow" + (e.error ? " err" : "")}>
            <div><b>#{e.id}</b> {e.mode === "instruction" && <span className="tag">🪄 Instrucción</span>} {e.model.replace("claude-", "")} · “{e.delta.length > 60 ? e.delta.slice(0, 60) + "…" : e.delta}”</div>
            <div>
              1.ª op {e.firstOpMs ?? "—"} ms · voz→1.ª figura {e.voiceFirstMs ?? "—"} ms · total {e.totalMs ?? "…"} ms · {e.ops} ops · in {e.usage.input_tokens} / caché {e.usage.cache_read_input_tokens} / out {e.usageEstimated ? "≈" : ""}{e.usage.output_tokens} · {fmtUsd(e.costUsd)}
            </div>
            {e.mode === "instruction" && (e.undone ? <div>↩ deshecha</div> : e.done && !e.error && <div>✓ aplicada ({e.ops} cambios)</div>)}
            {e.warnings.map((w, i) => <div key={i} className="warn">⚠ {w}</div>)}
            {e.error && <div className="warn">✖ {e.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
