import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useT } from "../../i18n";
import { Logo } from "../../ui/icons";
import type { RoomClient, RoomState } from "../client";
import { cleanName, initials, NAME_MAX } from "../identity";
import { leaveRoomUrl, roomUrl, shareInfo, startRoom } from "../start";
import type { ShareInfo } from "../start";

/** How long Claude's speech bubble stays by its avatar. */
export const SAY_MS = 9000;
/** How long a refusal from the server (a limit was hit) stays on screen. */
export const ERROR_MS = 7000;
/** Avatars shown before the rest fold into "+N". */
const MAX_AVATARS = 5;

interface Props {
  /** The room this page is in; null outside one. */
  room: { client: RoomClient; state: RoomState } | null;
  /** Outside a room: whether a room can be started now (live mode, server reachable). */
  canCollaborate?: boolean;
  /** Outside a room: the ops of the board on screen, which the new room starts from. */
  seedOps?(): { name: string; input: unknown }[];
  /** Goes to a URL (default: a full page load, which is how a room is entered and left). */
  navigate?(url: string): void;
}

const Ico = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const IconPeople = () => <Ico><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.5a6 6 0 0 1 3 5.5" /></Ico>;
const IconExit = () => <Ico><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" /></Ico>;
const IconLink = () => <Ico><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Ico>;
const IconCheck = () => <Ico><path d="M5 12.5l4.5 4.5L19 7.5" /></Ico>;
const IconPencil = () => <Ico><path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" /></Ico>;

/** Closes a popover on Escape or a press outside `ref`. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const press = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", press, true);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", press, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` and `ref` are stable enough: only `open` re-binds
  }, [open]);
}

/**
 * Top right of the board. In a room: everyone here as round avatars (me first), Claude with what it is doing,
 * its speech bubble when it answers, and Share. Outside a room: the button that opens one from this board.
 */
export function PresenceBar({ room, canCollaborate = true, seedOps, navigate = (url) => location.assign(url) }: Props) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<"share" | "rename" | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState("");
  const [say, setSay] = useState<{ id: number; text: string } | null>(null);
  useDismiss(panel !== null, root, () => setPanel(null));

  // Shared through a tunnel, the link to hand out is the public one, which only the server knows (and only
  // tells the owner). Anywhere else the link is this page's address.
  const inRoom = !!room;
  const [info, setInfo] = useState<ShareInfo | null>(null);
  useEffect(() => {
    if (!inRoom) return;
    let on = true;
    void shareInfo().then((i) => { if (on) setInfo(i); });
    return () => { on = false; };
  }, [inRoom]);

  // What the server refused (too fast, the room's cap, Claude busy) shows for a few seconds.
  const errorAt = room?.state.errorAt ?? 0;
  const [alertAt, setAlertAt] = useState(0);
  useEffect(() => {
    if (!errorAt) return;
    setAlertAt(errorAt);
    const timer = setTimeout(() => setAlertAt((a) => (a === errorAt ? 0 : a)), ERROR_MS);
    return () => clearTimeout(timer);
  }, [errorAt]);

  // Claude's latest `say` pops by its avatar for a few seconds. One that was already in the log when this
  // browser joined is old news and stays in the feed only.
  const feed = room?.state.feed;
  const lastSay = feed ? [...feed].reverse().find((f) => f.kind === "say") : undefined;
  const lastSayId = lastSay?.id ?? 0;
  const firstSay = useRef<number | null>(null);
  useEffect(() => {
    if (!room) { firstSay.current = null; return; }
    if (firstSay.current === null) { firstSay.current = room.state.status === "open" ? lastSayId : null; return; }
    if (!lastSay || lastSayId <= firstSay.current) return;
    firstSay.current = lastSayId;
    setSay({ id: lastSayId, text: lastSay.text });
    const timer = setTimeout(() => setSay((s) => (s?.id === lastSayId ? null : s)), SAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the say's id and the connection
  }, [lastSayId, room?.state.status]);

  if (!room) {
    if (!canCollaborate) return null;
    const collaborate = async () => {
      setStarting(true);
      setFailed("");
      try {
        navigate(roomUrl(await startRoom(seedOps?.() ?? [])));
      } catch (e) {
        setFailed(t("room.collaborate.failed", { error: e instanceof Error ? e.message : String(e) }));
        setStarting(false);
      }
    };
    return (
      <div className="presence solo" ref={root} data-testid="presence">
        <button className="share" data-testid="collaborate" title={t("room.collaborate.title")} disabled={starting} onClick={() => void collaborate()}>
          <IconPeople /> {t("room.collaborate")}
        </button>
        {failed && <div className="pop warn" role="alert">{failed}</div>}
      </div>
    );
  }

  const { client, state } = room;
  const link = roomUrl({ id: state.roomId, token: client.token }, info?.publicUrl ?? undefined);
  // a link to this machine opens nothing anywhere else
  const localOnly = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(link).hostname);
  const denied = state.status === "refused" || state.status === "full";
  const alert = alertAt && alertAt === state.errorAt && state.error ? (state.errorCode ? t(`room.error.${state.errorCode}`) : state.error) : "";
  const shown = state.participants.slice(0, MAX_AVATARS);
  const extra = state.participants.length - shown.length;
  const offline = state.status !== "open";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* no clipboard permission: the link is in the field, selected */ }
  };
  const openRename = () => { setName(state.me?.name ?? ""); setPanel(panel === "rename" ? null : "rename"); };
  const rename = () => { if (cleanName(name)) client.rename(name); setPanel(null); };
  const claudeLabel = t(state.claude === "thinking" ? "room.claude.thinking" : state.claude === "drawing" ? "room.claude.drawing" : "room.claude.idle");

  return (
    <div className="presence" ref={root} data-testid="presence">
      <div className="bar">
        {offline && !denied && <span className="pill" role="status" data-testid="room-offline">{t(state.status === "connecting" ? "room.connecting" : "room.reconnecting")}</span>}
        <div className="people" role="list" aria-label={t("room.people", { count: state.participants.length })}>
          {shown.map((p) => {
            const mine = p.id === state.me?.id;
            const style = { "--who": p.color } as CSSProperties;
            return mine ? (
              <button key={p.id} role="listitem" className="avatar me" style={style} data-testid="avatar-me" title={`${p.name} (${t("room.you")}) · ${t("room.rename")}`} aria-label={`${p.name} (${t("room.you")}). ${t("room.rename")}`} onClick={openRename}>{initials(p.name)}</button>
            ) : (
              <span key={p.id} role="listitem" className="avatar" style={style} title={p.name} aria-label={p.name}>{initials(p.name)}</span>
            );
          })}
          {extra > 0 && <span role="listitem" className="avatar more" title={state.participants.slice(MAX_AVATARS).map((p) => p.name).join(", ")}>+{extra}</span>}
        </div>
        <span className="sep" />
        <span className={"avatar claude " + state.claude} data-testid="avatar-claude" role="img" aria-label={claudeLabel} title={claudeLabel}>
          <Logo />
          {state.claude === "drawing" && <i className="pen"><IconPencil /></i>}
          {state.claude === "thinking" && <i className="dots"><b /><b /><b /></i>}
        </span>
        {state.claude !== "idle" && <span className="doing" role="status">{t(state.claude === "thinking" ? "room.status.thinking" : "room.status.drawing")}</span>}
        <button className="share" data-testid="share" aria-expanded={panel === "share"} title={t("room.share.title")} onClick={() => setPanel(panel === "share" ? null : "share")}>
          <IconLink /> {t("room.share")}
        </button>
        <button className="leave" data-testid="leave" aria-label={t("room.leave")} title={t("room.leave")} onClick={() => navigate(leaveRoomUrl())}><IconExit /></button>
      </div>

      {denied && <div className="pop warn" role="alert" data-testid="room-denied">{t(state.status === "full" ? "room.full" : "room.refused")}</div>}
      {!denied && alert && <div className="pop warn" role="alert" data-testid="room-error">{alert}</div>}

      {say && (
        <div className="room-say" data-testid="room-say" role="status" key={say.id}>
          <div className="box"><span className="who">Claude</span><br />{say.text}</div>
        </div>
      )}

      {panel === "share" && (
        <div className="pop" data-testid="share-pop">
          <strong>{t("room.share.title")}</strong>
          <p>{t("room.share.hint")}</p>
          <p data-testid="share-note">{t(localOnly ? "room.share.local" : "room.share.spend")}</p>
          <div className="row">
            <input readOnly value={link} aria-label={t("room.share")} onFocus={(e) => e.currentTarget.select()} />
            <button className={"pbtn primary" + (copied ? " done" : "")} data-testid="copy-link" onClick={() => void copy()}>
              {copied ? <><IconCheck /> {t("room.share.copied")}</> : t("room.share.copy")}
            </button>
          </div>
          <div className="foot">
            <span>{t("room.people", { count: state.participants.length })}</span>
            <button className="pbtn" data-testid="leave-room" onClick={() => navigate(leaveRoomUrl())}>{t("room.leave")}</button>
          </div>
        </div>
      )}

      {panel === "rename" && (
        <form className="pop" data-testid="rename-pop" onSubmit={(e) => { e.preventDefault(); rename(); }}>
          <strong>{t("room.rename")}</strong>
          <div className="row">
            <input autoFocus maxLength={NAME_MAX} value={name} aria-label={t("room.rename")} onChange={(e) => setName(e.target.value)} />
            <button className="pbtn primary" type="submit" disabled={!cleanName(name)}>{t("room.rename.save")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
