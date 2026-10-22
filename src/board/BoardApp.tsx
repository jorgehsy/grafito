import { useCallback, useEffect, useRef, useState } from "react";
import { BoardController } from "./controller";
import { Player } from "./player";
import type { Subtitle } from "./player";
import { SCRIPTS } from "./scripts";
import { Engine } from "./render/engine";
import { LivePanel } from "./live/LivePanel";

type Status = "idle" | "playing" | "paused" | "done";

export function BoardApp() {
  const svgRef = useRef<SVGSVGElement>(null);
  const engine = useRef<Engine | null>(null);
  const ctrl = useRef<BoardController | null>(null);
  const player = useRef<Player | null>(null);
  const status = useRef<Status>("idle");
  const speedRef = useRef(1);
  const subRef = useRef<HTMLDivElement>(null);

  const [scriptId, setScriptId] = useState(() => new URLSearchParams(location.search).get("script") ?? SCRIPTS[0].id);
  const [st, setSt] = useState<Status>("idle");
  const [speed, setSpeed] = useState(() => Number(new URLSearchParams(location.search).get("speed")) || 1);
  const [follow, setFollow] = useState(true);
  const [backlog, setBacklog] = useState({ pending: 0, speed: 1 });
  const [sub, setSub] = useState<Subtitle>({ spoken: [], current: "" });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [mode, setMode] = useState<"script" | "claude">(() => (new URLSearchParams(location.search).get("mode") === "claude" ? "claude" : "script"));

  const setStatus = (s: Status) => { status.current = s; setSt(s); };

  useEffect(() => {
    const e = new Engine(svgRef.current!);
    engine.current = e;
    e.onFollowChange = setFollow;
    const c = new BoardController(e);
    c.queue.onChange = (pending, sp) => setBacklog({ pending, speed: sp });
    c.onWarnings = (w) => setWarnings((p) => [...p, ...w].slice(-6));
    c.onBoard = (b) => setSummary(b.summary);
    ctrl.current = c;
    (window as any).__grafito = { engine: e, controller: c };
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      if (status.current === "playing") player.current?.tick(dt * speedRef.current);
    };
    raf = requestAnimationFrame(loop);
    const auto = new URLSearchParams(location.search).get("auto");
    if (auto) setTimeout(() => play(), 200);
    return () => { cancelAnimationFrame(raf); e.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { speedRef.current = speed; if (engine.current) engine.current.userSpeed = speed; }, [speed]);
  useEffect(() => { subRef.current?.scrollTo({ top: subRef.current.scrollHeight, behavior: "smooth" }); }, [sub]);

  const resetAll = useCallback(() => {
    ctrl.current?.reset();
    engine.current?.reset();
    engine.current?.setPaused(false);
    player.current = null;
    setSub({ spoken: [], current: "" });
    setWarnings([]);
    setBacklog({ pending: 0, speed: 1 });
  }, []);

  const play = useCallback(() => {
    if (status.current === "paused") { engine.current?.setPaused(false); setStatus("playing"); return; }
    if (status.current === "playing") return;
    resetAll();
    const id = new URLSearchParams(location.search).get("auto") ?? scriptRef.current;
    const info = SCRIPTS.find((s) => s.id === id) ?? SCRIPTS[0];
    player.current = new Player(info.script, {
      onSubtitle: setSub,
      onOps: (ops) => { void ctrl.current?.submit(ops); },
      onEnd: () => setStatus("done"),
    });
    setStatus("playing");
  }, [resetAll]);

  const scriptRef = useRef(scriptId);
  useEffect(() => { scriptRef.current = scriptId; }, [scriptId]);

  const pause = () => {
    if (status.current !== "playing") return;
    engine.current?.setPaused(true);
    setStatus("paused");
  };
  const restart = () => { resetAll(); setStatus("idle"); };
  const toggleFollow = (v: boolean) => { engine.current?.setFollow(v); setFollow(v); };

  return (
    <div className="v2">
      <div className="canvas2">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" />
        {st === "idle" && mode === "script" && <div className="hint">Elige un guion y pulsa Play para ver el tablero dibujarse mientras se "dicta".</div>}
      </div>
      <aside className="side">
        <h1>grafito <small>v2 · {mode === "claude" ? "Claude en vivo" : "maqueta sin Claude"}</small></h1>
        <div className="row modes">
          <button className={mode === "script" ? "primary" : ""} disabled={st === "playing" || st === "paused"} onClick={() => { resetAll(); setStatus("idle"); setMode("script"); }}>Guion (sin Claude)</button>
          <button className={mode === "claude" ? "primary" : ""} disabled={st === "playing" || st === "paused"} onClick={() => { resetAll(); setStatus("idle"); setMode("claude"); }}>Claude en vivo</button>
        </div>
        {mode === "script" ? (
          <>
        <label className="field">
          Guion
          <select value={scriptId} disabled={st === "playing" || st === "paused"} onChange={(e) => setScriptId(e.target.value)}>
            {SCRIPTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="row">
          <button className="primary" onClick={play} disabled={st === "playing"}>{st === "paused" ? "Seguir" : "Play"}</button>
          <button onClick={pause} disabled={st !== "playing"}>Pausa</button>
          <button onClick={restart}>Reiniciar</button>
        </div>
        <label className="field">
          Velocidad: {speed}x
          <input type="range" min={0.5} max={2} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
          </>
        ) : (
          <LivePanel getCtrl={() => ctrl.current} onSubtitle={setSub} onClear={() => { resetAll(); }} />
        )}
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => toggleFollow(e.target.checked)} /> Seguir cámara
        </label>
        <div className="backlog" data-testid="backlog">
          Cola de dibujo: <b>{backlog.pending}</b> pendiente{backlog.pending === 1 ? "" : "s"}
          {" · "}{Number.isFinite(backlog.speed) ? `${backlog.speed.toFixed(1)}x` : "al instante"}
          <div className="bar"><div style={{ width: `${Math.min(100, (backlog.pending / 12) * 100)}%` }} /></div>
        </div>
        <div className="subs" ref={subRef} data-testid="subtitles">
          {sub.spoken.map((t, i) => <p key={i} className="old">{t}</p>)}
          {sub.current && <p className={sub.interim ? "now interim" : "now"}>{sub.current}</p>}
          {!sub.spoken.length && !sub.current && <p className="old">Aquí aparecerá lo que se va diciendo.</p>}
        </div>
        {summary && <div className="summary"><b>Resumen:</b> {summary}</div>}
        {warnings.length > 0 && <div className="warns">{warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
      </aside>
    </div>
  );
}
