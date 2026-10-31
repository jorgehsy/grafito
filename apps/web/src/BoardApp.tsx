import { useCallback, useEffect, useRef, useState } from "react";
import { BoardController } from "@grafito/board";
import { Player } from "@grafito/board";
import type { Subtitle } from "@grafito/board";
import { SCRIPTS } from "./scripts";
import { Engine } from "./render/engine";
import { LivePanel } from "./live/LivePanel";
import { useT } from "./i18n";
import { IconChevron, IconPause, IconPlay, IconRestart, IconWave, Logo } from "./ui/icons";

type Status = "idle" | "playing" | "paused" | "done";
type Mode = "demo" | "live";

const urlMode = (): Mode | null => { const m = new URLSearchParams(location.search).get("mode"); return m === "live" || m === "demo" ? m : null; };
const readTranscript = () => { try { return localStorage.getItem("grafito.transcript") !== "0"; } catch { return true; } };

export function BoardApp() {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const engine = useRef<Engine | null>(null);
  const ctrl = useRef<BoardController | null>(null);
  const player = useRef<Player | null>(null);
  const status = useRef<Status>("idle");
  const speedRef = useRef(1);
  const subRef = useRef<HTMLDivElement>(null);

  const [demoId, setDemoId] = useState(() => new URLSearchParams(location.search).get("demo") ?? SCRIPTS[0].id);
  const [st, setSt] = useState<Status>("idle");
  const [speed, setSpeed] = useState(() => Number(new URLSearchParams(location.search).get("speed")) || 1);
  const [follow, setFollow] = useState(true);
  const [backlog, setBacklog] = useState({ pending: 0, speed: 1 });
  const [sub, setSub] = useState<Subtitle>({ spoken: [], current: "" });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  // Without ?mode= in the URL the default depends on whether the server has an API key: live if so, demo if not.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only setup; later changes are read through refs
  }, []);

  useEffect(() => {
    if (mode) return;
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => h?.hasKey === true, () => false)
      .then((key) => { if (alive) setMode((m) => m ?? (key ? "live" : "demo")); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time health probe on mount
  }, []);

  useEffect(() => { try { localStorage.setItem("grafito.transcript", showTranscript ? "1" : "0"); } catch { /* storage unavailable */ } }, [showTranscript]);

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
    const id = new URLSearchParams(location.search).get("auto") ?? demoRef.current;
    const info = SCRIPTS.find((s) => s.id === id) ?? SCRIPTS[0];
    player.current = new Player(info.script, {
      onSubtitle: setSub,
      onOps: (ops) => { void ctrl.current?.submit(ops); },
      onEnd: () => setStatus("done"),
    });
    setStatus("playing");
  }, [resetAll]);

  const demoRef = useRef(demoId);
  useEffect(() => { demoRef.current = demoId; }, [demoId]);

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
        {st === "idle" && mode === "demo" && <div className="hint">{t("app.demoHint")}</div>}
      </div>

      <header className="brand">
        <Logo />
        <span className="word">grafito</span>
        {mode === "live" && <span className="board">{t("app.liveBadge")}</span>}
        {mode === "demo" && (
          <div className="scriptbar" role="group" aria-label={t("app.demoBar")}>
            <select aria-label={t("app.demoBar")} value={demoId} disabled={locked} onChange={(e) => setDemoId(e.target.value)}>
              {SCRIPTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {st === "playing" ? (
              <button className="tb sm" aria-label={t("app.pause")} title={t("app.pause")} onClick={pause}><IconPause /></button>
            ) : (
              <button className="tb sm on" aria-label={st === "paused" ? t("app.resume") : t("app.play")} title={st === "paused" ? t("app.resume") : t("app.play")} onClick={play}><IconPlay /></button>
            )}
            <button className="tb sm" aria-label={t("app.restart")} title={t("app.restart")} onClick={restart}><IconRestart /></button>
            <label className="spd">
              {speed}x
              <input type="range" aria-label={t("app.speed")} min={0.5} max={2} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
          </div>
        )}
      </header>

      <LivePanel
        getCtrl={() => ctrl.current}
        onSubtitle={setSub}
        onClear={() => { resetAll(); }}
        active={mode === "live"}
        onMode={changeMode}
        modeLocked={locked}
        follow={follow}
        onFollow={toggleFollow}
        summary={summary}
        warnings={warnings}
        showTranscript={showTranscript}
        onShowTranscript={setShowTranscript}
      />

      <button className={"notch" + (showTranscript ? "" : " off")} data-testid="transcript-toggle" aria-pressed={showTranscript} aria-label={showTranscript ? t("app.transcript.hide") : t("app.transcript.show")} title={showTranscript ? t("app.transcript.hide") : t("app.transcript.show")} onClick={() => setShowTranscript((v) => !v)}>
        <IconChevron up={!showTranscript} />
      </button>

      <div className="subtitles" data-testid="subtitles" role="status" ref={subRef} hidden={!showTranscript}>
        <span className="wv"><IconWave /></span>
        <div className="txt">
          {!sub.spoken.length && !sub.current ? (
            <p className="old">{t("app.transcript.empty")}</p>
          ) : (
            <>
              {sub.spoken.slice(-1).map((t, i) => (sub.current ? <p key={i} className="old">{t}</p> : <p key={i} className="now">{t}</p>))}
              {sub.current && <p className={sub.interim ? "now interim" : "now"}>{sub.current}</p>}
            </>
          )}
          <div className="backlog" data-testid="backlog">{t("app.queue", { count: queued })}</div>
        </div>
      </div>
    </div>
  );
}
