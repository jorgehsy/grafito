import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import { applyOp, emptyMap, type MindMap } from "./mindmap/model";
import { computeLayout } from "./mindmap/layout";
import { buildElements, pushScene } from "./mindmap/render";
import { createScheduler } from "./live/scheduler";
import { streamDraw, toOp } from "./live/drawClient";
import { SAMPLES } from "./samples";

interface LogEntry {
  id: number;
  text: string;
  model: string;
  firstOp?: number | null;
  total?: number;
  ops: number;
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  warnings: string[];
  error?: string;
  running: boolean;
}

const splitSentences = (t: string) =>
  t.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/).filter(Boolean);

export function App() {
  const [text, setText] = useState(SAMPLES[0].text);
  const [sampleId, setSampleId] = useState(SAMPLES[0].id);
  const [model, setModel] = useState("claude-haiku-5-5");
  const [delay, setDelay] = useState(1500);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const apiRef = useRef<any>(null);
  const mapRef = useRef<MindMap>(emptyMap());
  const summaryRef = useRef("");
  const knownRef = useRef<Set<string>>(new Set());
  const modelRef = useRef(model);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const entryId = useRef(0);
  const rafRef = useRef<number | null>(null);
  modelRef.current = model;

  const redraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const api = apiRef.current;
      if (!api) return;
      const els = buildElements(mapRef.current, computeLayout(mapRef.current));
      knownRef.current = pushScene(api, els, knownRef.current);
    });
  }, []);

  const patchEntry = (id: number, f: (e: LogEntry) => LogEntry) =>
    setLog((l) => l.map((e) => (e.id === id ? f(e) : e)));

  const sendChunk = useCallback(
    async (chunk: string) => {
      const id = ++entryId.current;
      const usedModel = modelRef.current;
      setLog((l) => [{ id, text: chunk, model: usedModel, ops: 0, warnings: [], running: true }, ...l]);
      setBusy(true);
      const ctl = new AbortController();
      abortRef.current = ctl;
      await streamDraw(
        { delta: chunk, summary: summaryRef.current, map: mapRef.current, model: usedModel },
        {
          onOp(name, input) {
            const op = toOp(name, input);
            if (!op) return patchEntry(id, (e) => ({ ...e, warnings: [...e.warnings, `op desconocida ${name}`] }));
            if (op.type === "update_summary") summaryRef.current = op.text;
            const r = applyOp(mapRef.current, op);
            mapRef.current = r.map;
            patchEntry(id, (e) => ({ ...e, ops: e.ops + 1, warnings: r.warning ? [...e.warnings, r.warning] : e.warnings }));
            redraw();
          },
          onInvalid: (w) => patchEntry(id, (e) => ({ ...e, warnings: [...e.warnings, w] })),
          onDone: (d) =>
            patchEntry(id, (e) => ({
              ...e,
              running: false,
              firstOp: d.timings.first_op_ms,
              total: d.timings.total_ms,
              input: d.usage.input_tokens,
              cacheRead: d.usage.cache_read_input_tokens,
              cacheWrite: d.usage.cache_creation_input_tokens,
              output: d.usage.output_tokens,
            })),
          onError(message) {
            setFatal(message);
            patchEntry(id, (e) => ({ ...e, running: false, error: message }));
          },
        },
        ctl.signal,
      );
      patchEntry(id, (e) => ({ ...e, running: false }));
    },
    [redraw],
  );

  const scheduler = useMemo(() => createScheduler(sendChunk, () => setBusy(false)), [sendChunk]);

  const stopAll = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    scheduler.stop();
    abortRef.current?.abort();
    setBusy(false);
  };
  useEffect(() => () => stopAll(), []); // eslint-disable-line

  const sendAll = () => {
    setFatal(null);
    scheduler.onFinalText(text);
  };
  const simulate = () => {
    setFatal(null);
    stopAll();
    const parts = splitSentences(text);
    let i = 0;
    const tick = () => {
      if (i >= parts.length) {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        return;
      }
      scheduler.onFinalText(parts[i++]);
    };
    tick();
    timerRef.current = window.setInterval(tick, delay);
  };

  const clearMap = () => {
    stopAll();
    mapRef.current = emptyMap();
    summaryRef.current = "";
    knownRef.current = new Set();
    setLog([]);
    setFatal(null);
    apiRef.current?.updateScene({ elements: [] });
  };

  const exportPng = async () => {
    const api = apiRef.current;
    if (!api) return;
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), exportBackground: true },
      files: api.getFiles(),
      mimeType: "image/png",
    });
    download(blob, "grafito.png");
  };
  const saveJson = () => {
    const data = { version: 1, map: mapRef.current, summary: summaryRef.current };
    download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "grafito.json");
  };
  const openJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j.map?.nodes) throw new Error("formato inválido");
      mapRef.current = j.map;
      summaryRef.current = j.summary ?? "";
      knownRef.current = new Set();
      redraw();
    } catch (e: any) {
      setFatal("No se pudo abrir el archivo: " + e.message);
    }
  };

  return (
    <div className="layout">
      <div className="canvas">
        <Excalidraw excalidrawAPI={(a) => (apiRef.current = a)} langCode="es-ES" />
      </div>
      <div className="panel">
        <h1>grafito · prototipo 1</h1>
        {fatal && <div className="err">{fatal}</div>}
        <div className="row">
          <select
            value={sampleId}
            onChange={(e) => {
              setSampleId(e.target.value);
              setText(SAMPLES.find((s) => s.id === e.target.value)!.text);
            }}
          >
            {SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="claude-haiku-5-5">Haiku 5.5 (rápido)</option>
            <option value="claude-sonnet-5-5">Sonnet 5.5</option>
          </select>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Pega aquí el monólogo…" />
        <div className="row">
          <button className="primary" onClick={sendAll}>Enviar todo</button>
          <button className="primary" onClick={simulate}>Simular dictado</button>
          <button className="danger" onClick={stopAll} disabled={!busy && !timerRef.current}>Detener</button>
          <button onClick={clearMap}>Limpiar mapa</button>
        </div>
        <label className="small">
          Un fragmento cada {delay} ms
          <input type="range" min={500} max={4000} step={100} value={delay} onChange={(e) => setDelay(+e.target.value)} style={{ width: "100%" }} />
        </label>
        <div className="row">
          <button onClick={exportPng}>Exportar PNG</button>
          <button onClick={saveJson}>Guardar JSON</button>
          <label className="small">
            Abrir JSON <input type="file" accept="application/json" onChange={(e) => openJson(e.target.files?.[0])} />
          </label>
        </div>
        <div className="log">
          {log.map((e) => (
            <div className="entry" key={e.id}>
              <div className="txt">“{e.text.length > 90 ? e.text.slice(0, 90) + "…" : e.text}”</div>
              <div className="meta">
                {e.running ? "en curso… " : ""}
                {e.model.replace("claude-", "")} · 1.ª op: {e.firstOp ?? "—"} ms · total: {e.total ?? "—"} ms · {e.ops} ops
                <br />
                tokens entrada {e.input ?? "—"} · caché leída {e.cacheRead ?? "—"} (escrita {e.cacheWrite ?? "—"}) · salida {e.output ?? "—"}
              </div>
              {e.warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
              {e.error && <div className="bad">{e.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
