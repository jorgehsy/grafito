import { useCallback, useEffect, useRef, useState } from "react";
import { BoardController } from "@grafito/board";
import { Player } from "@grafito/board";
import type { Subtitle } from "@grafito/board";
import { SCRIPTS } from "./scripts";
import { Engine } from "./render/engine";
import { LivePanel } from "./live/LivePanel";
import { IconChevron, IconPause, IconPlay, IconRestart, IconWave, Logo } from "./ui/icons";

type Status = "idle" | "playing" | "paused" | "done";
type Mode = "script" | "claude";

const urlMode = (): Mode | null => { const m = new URLSearchParams(location.search).get("mode"); return m === "claude" || m === "script" ? m : null; };
const readTranscript = () => { try { return localStorage.getItem("grafito.transcript") !== "0"; } catch { return true; } };

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
  // Sin ?mode= en la URL, el modo por defecto depende de si el servidor tiene API key: en vivo si la hay, guion si no.
  const [mode, setMode] = useState<Mode | null>(urlMode);
  const [showTranscript, setShowTranscript] = useState(readTranscript);

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

  useEffect(() => {
    if (mode) return;
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => h?.hasKey === true, () => false)
      .then((key) => { if (alive) setMode((m) => m ?? (key ? "claude" : "script")); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { try { localStorage.setItem("grafito.transcript", showTranscript ? "1" : "0"); } catch { /* sin almacenamiento */ } }, [showTranscript]);

  useEffect(() => { speedRef.current = speed; if (engine.current) engine.current.userSpeed = speed; }, [speed]);

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

  const locked = st === "playing" || st === "paused";
  const changeMode = (m: Mode) => { if (m === mode) return; resetAll(); setStatus("idle"); setMode(m); };
  const queued = backlog.pending;

  return (
    <div className="v2">
      <div className="canvas2">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" />
        {st === "idle" && mode === "script" && <div className="hint">Elige un guion y pulsa Play para ver el tablero dibujarse mientras se "dicta".</div>}
      </div>

      <header className="brand">
        <Logo />
        <span className="word">grafito</span>
        {mode === "claude" && <span className="board">Claude en vivo</span>}
        {mode === "script" && (
          <div className="scriptbar" role="group" aria-label="Guion">
            <select aria-label="Guion" value={scriptId} disabled={locked} onChange={(e) => setScriptId(e.target.value)}>
              {SCRIPTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {st === "playing" ? (
              <button className="tb sm" aria-label="Pausa" title="Pausa" onClick={pause}><IconPause /></button>
            ) : (
              <button className="tb sm on" aria-label={st === "paused" ? "Seguir" : "Play"} title={st === "paused" ? "Seguir" : "Play"} onClick={play}><IconPlay /></button>
            )}
            <button className="tb sm" aria-label="Reiniciar" title="Reiniciar" onClick={restart}><IconRestart /></button>
            <label className="spd">
              {speed}x
              <input type="range" aria-label="Velocidad" min={0.5} max={2} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
          </div>
        )}
      </header>

      <LivePanel
        getCtrl={() => ctrl.current}
        onSubtitle={setSub}
        onClear={() => { resetAll(); }}
        active={mode === "claude"}
        onMode={changeMode}
        modeLocked={locked}
        follow={follow}
        onFollow={toggleFollow}
        summary={summary}
        warnings={warnings}
        showTranscript={showTranscript}
        onShowTranscript={setShowTranscript}
      />

      <button className={"notch" + (showTranscript ? "" : " off")} data-testid="transcript-toggle" aria-pressed={showTranscript} aria-label={showTranscript ? "Ocultar transcripción" : "Mostrar transcripción"} title={showTranscript ? "Ocultar transcripción" : "Mostrar transcripción"} onClick={() => setShowTranscript((v) => !v)}>
        <IconChevron up={!showTranscript} />
      </button>

      <div className="subtitles" data-testid="subtitles" role="status" ref={subRef} hidden={!showTranscript}>
        <span className="wv"><IconWave /></span>
        <div className="txt">
          {!sub.spoken.length && !sub.current ? (
            <p className="old">Aquí aparecerá lo que se va diciendo.</p>
          ) : (
            <>
              {sub.spoken.slice(-1).map((t, i) => (sub.current ? <p key={i} className="old">{t}</p> : <p key={i} className="now">{t}</p>))}
              {sub.current && <p className={sub.interim ? "now interim" : "now"}>{sub.current}</p>}
            </>
          )}
          <div className="backlog" data-testid="backlog">{queued} {queued === 1 ? "frase" : "frases"} en cola</div>
        </div>
      </div>
    </div>
  );
}
