import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardController, applyArchitectOp } from "@grafito/board";
import type { Subtitle } from "@grafito/board";
import { useScript } from "./script/useScript";
import { ScriptPlayer } from "./script/ScriptPlayer";
import { Engine } from "./render/engine";
import { LivePanel } from "./live/ui/LivePanel";
import { ArchitectPanel } from "./architect/ui/ArchitectPanel";
import type { ArchitectRecordControl } from "./architect/ui/ArchitectPanel";
import type { ArchitectRecord } from "@grafito/contract";
import type { ModelControl } from "./live/models";
import { useT } from "./i18n";
import { readFlag, writeFlag } from "./storage";
import { IconChevron, IconMicOff, IconWave, Logo } from "./ui/icons";
import { createLocalSketchStore } from "./sketch/store";
import type { SketchStore } from "./sketch/store";
import { StartHint } from "./sketch/DrawDock";
import { leaveRoomUrl, roomIdFromUrl } from "./room/start";
import { useRoom } from "./room/ui/useRoom";
import type { RoomCanvas } from "./room/ui/useRoom";
import { JoinDialog } from "./room/ui/JoinDialog";
import { createRoomSession } from "./room/session";
import type { SessionFactory } from "./live/ui/useLiveSession";

type Mode = "demo" | "live" | "architect";
const TRANSCRIPT_KEY = "grafito.transcript";

const urlMode = (): Mode | null => { const m = new URLSearchParams(location.search).get("mode"); return m === "live" || m === "demo" || m === "architect" ? m : null; };

export function BoardApp() {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const engine = useRef<Engine | null>(null);
  const ctrl = useRef<BoardController | null>(null);
  const subRef = useRef<HTMLDivElement>(null);

  const [follow, setFollow] = useState(true);
  const [backlog, setBacklog] = useState({ pending: 0, speed: 1 });
  const [sub, setSub] = useState<Subtitle>({ spoken: [], current: "" });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  // Without ?mode= in the URL the default depends on whether the server has an API key: live if so, demo if not.
  // ?mode=architect opens architect mode straight away, without waiting on that probe.
  // A room (`?room=<id>`) is always live mode: the board is shared and the server calls Claude.
  const [roomId] = useState(roomIdFromUrl);
  const [mode, setMode] = useState<Mode | null>(() => (roomId ? "live" : urlMode()));
  // The architect panel starts its session on mount, which needs the controller made by the effect below.
  const [ready, setReady] = useState(false);
  const [mute, setMute] = useState<{ muted: boolean; toggle(): void } | null>(null);
  const [architectModel, setArchitectModel] = useState<ModelControl | null>(null);
  const [architectSession, setArchitectSession] = useState<ArchitectRecordControl | null>(null);
  // An imported architect record waiting for the architect panel to mount and reopen it.
  const [architectSeed, setArchitectSeed] = useState<ArchitectRecord | null>(null);
  const [showTranscript, setShowTranscript] = useState(() => readFlag(TRANSCRIPT_KEY, true));
  // The sketch people draw on the board. Alone it lives in this page; a room swaps in its own store.
  const [localSketch] = useState<SketchStore>(createLocalSketchStore);
  const canvas = useMemo<RoomCanvas>(() => ({
    onPointer: (fn) => { if (engine.current) engine.current.onPointer = fn ?? undefined; },
    setCursors: (list) => engine.current?.setCursors(list),
  }), []);
  const room = useRoom(roomId, ready ? canvas : null);
  const roomClient = room.client;
  const sketch = roomClient?.sketch ?? localSketch;
  // In a room the panel talks to a session that speaks to the room's socket instead of calling Claude itself.
  const createSession = useMemo<SessionFactory | undefined>(() => (roomClient ? (deps) => createRoomSession(roomClient, deps) : undefined), [roomClient]);
  // Nothing drawn yet, by Claude or by hand: the board shows how to start.
  const [blank, setBlank] = useState(true);

  useEffect(() => {
    const e = new Engine(svgRef.current!);
    engine.current = e;
    e.onFollowChange = setFollow;
    const c = new BoardController(e);
    c.queue.onChange = (pending, sp) => setBacklog({ pending, speed: sp });
    c.onWarnings = (w) => setWarnings((p) => [...p, ...w].slice(-6));
    c.onBoard = (b) => { setSummary(b.summary); boardEmpty.current = !b.zones.length; refreshBlank.current(); };
    ctrl.current = c;
    setReady(true);
    (window as any).__grafito = { engine: e, controller: c };
    return () => e.dispose();
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

  useEffect(() => writeFlag(TRANSCRIPT_KEY, showTranscript), [showTranscript]);

  const boardEmpty = useRef(true);
  const refreshBlank = useRef(() => {});
  useEffect(() => {
    engine.current?.setSketch(sketch);
    refreshBlank.current = () => setBlank(boardEmpty.current && !sketch.strokes().length);
    refreshBlank.current();
    const off = sketch.subscribe(() => refreshBlank.current());
    return () => { off(); engine.current?.setSketch(null); };
  }, [sketch]);

  const resetBoard = useCallback(() => {
    ctrl.current?.reset();
    engine.current?.reset();
    engine.current?.setPaused(false);
    setSub({ spoken: [], current: "" });
    setWarnings([]);
    setBacklog({ pending: 0, speed: 1 });
  }, []);

  // Demo mode's player: the transport, the loaded demo or replay, and its own sketch (see script/useScript.ts).
  const script = useScript({ active: mode === "demo", getCtrl: () => ctrl.current, getEngine: () => engine.current, appSketch: sketch, resetBoard, onSubtitle: setSub });
  const stopScript = script.stop;
  const resetAll = useCallback(() => { stopScript(); resetBoard(); }, [stopScript, resetBoard]);

  const toggleFollow = (v: boolean) => { engine.current?.setFollow(v); setFollow(v); };

  const changeMode = (m: Mode) => {
    if (m === mode) return;
    // A room is live mode only: another mode means leaving it (Back returns to the room).
    if (roomId) return location.assign(leaveRoomUrl(undefined, m));
    resetAll();
    // The ink goes with the board it was drawn on (a room keeps its own).
    const ink = localSketch.strokes().map((s) => s.id);
    if (!roomId && ink.length) localSketch.remove(ink);
    setMode(m);
  };
  const openArchitect = (rec: ArchitectRecord) => {
    if (mode === "architect" && architectSession) return architectSession.restore(rec);
    setArchitectSeed(rec);
    changeMode("architect");
  };
  // The panel read the seed when it mounted (its effects run before this one).
  useEffect(() => { if (mode === "architect" && architectSeed) setArchitectSeed(null); }, [mode, architectSeed]);
  const queued = backlog.pending;

  return (
    <div className="v2">
      <div className="canvas2">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" />
        {mode === "live" && blank && <StartHint />}
      </div>

      <header className={"brand" + (queued > 0 ? " busy" : "")}>
        <Logo />
        <span className="word">grafito</span>
      </header>

      {mode === "demo" && <ScriptPlayer script={script} />}

      <LivePanel
        getCtrl={() => ctrl.current}
        getEngine={() => engine.current}
        sketch={sketch}
        createSession={createSession}
        me={room.state?.me ? { id: room.state.me.id, color: room.state.me.color } : undefined}
        room={roomId ? { id: roomId, client: room.client, state: room.state } : null}
        exportSvg={() => engine.current?.exportSvg() ?? null}
        onSubtitle={setSub}
        onClear={() => { resetAll(); }}
        mode={mode}
        onMode={changeMode}
        follow={follow}
        onFollow={toggleFollow}
        summary={summary}
        warnings={warnings}
        showTranscript={showTranscript}
        onShowTranscript={setShowTranscript}
        onMuteControl={setMute}
        modelControl={architectModel}
        architect={architectSession}
        onOpenArchitect={openArchitect}
      />

      {room.needsName && roomId && <JoinDialog roomId={roomId} onJoin={room.join} />}

      {mode === "architect" && ready && (
        <ArchitectPanel
          board={{ get: () => ctrl.current!.board, submit: (ops) => ctrl.current!.submit(ops, applyArchitectOp), clear: resetAll }}
          canvas={{
            onPick: (fn) => { if (engine.current) engine.current.onPick = fn ?? undefined; },
            select: (keys) => engine.current?.select(keys),
            screenRect: (key) => engine.current?.screenRect(key) ?? null,
          }}
          sketch={sketch}
          onModelControl={setArchitectModel}
          onRecordControl={setArchitectSession}
          initialRecord={architectSeed}
        />
      )}

      {mode !== "architect" && <button className={"notch" + (showTranscript ? "" : " off")} data-testid="transcript-toggle" aria-pressed={showTranscript} aria-label={showTranscript ? t("app.transcript.hide") : t("app.transcript.show")} title={showTranscript ? t("app.transcript.hide") : t("app.transcript.show")} onClick={() => setShowTranscript((v) => !v)}>
        <IconChevron up={!showTranscript} />
      </button>}

      <div className={"subtitles" + (!sub.spoken.length && !sub.current && !mute ? " empty" : "")} data-testid="subtitles" role="status" ref={subRef} hidden={!showTranscript || mode === "architect"}>
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
          <div className="backlog" data-testid="backlog" hidden={queued === 0}>{t("app.queue", { count: queued })}</div>
        </div>
        {mute && (
          <button className={"tb sm" + (mute.muted ? " on" : "")} data-testid="mute" aria-pressed={mute.muted} aria-label={mute.muted ? t("toolbar.mic.unmute") : t("toolbar.mic.mute")} title={mute.muted ? t("toolbar.mic.unmuteTitle") : t("toolbar.mic.muteTitle")} onClick={mute.toggle}>
            <IconMicOff />
          </button>
        )}
      </div>
    </div>
  );
}
