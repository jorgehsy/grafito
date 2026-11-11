import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useT } from "../../i18n";
import { readFlag, writeFlag } from "../../storage";
import { IconChevron } from "../../ui/icons";
import type { FeedItem, RoomState } from "../client";

const FEED_KEY = "grafito.room.feed";
const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

interface Props {
  state: RoomState;
}

/** The room's activity: who said, typed or sketched what, and what Claude answered. Newest at the bottom. */
export function Feed({ state }: Props) {
  const t = useT();
  const [open, setOpen] = useState(() => readFlag(FEED_KEY, true));
  const list = useRef<HTMLDivElement>(null);
  const feed = state.feed;
  const lastId = feed.length ? feed[feed.length - 1].id : 0;
  // What was already seen when the feed was folded, so the pill can count what came after.
  const [seen, setSeen] = useState(lastId);
  const unread = open ? 0 : feed.filter((f) => f.id > seen).length;
  const me = state.me?.id;

  useEffect(() => writeFlag(FEED_KEY, open), [open]);
  useEffect(() => {
    if (!open) return;
    setSeen(lastId);
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, lastId]);

  const line = (f: FeedItem) => {
    if (f.kind === "reset") return <span className="what dim">{t("room.feed.reset", { name: f.name || "?" })}</span>;
    if (f.kind === "say") return <span className="what say">{f.text}</span>;
    return (
      <span className="what">
        {f.mode === "instruction" && <i className="tag">{t("room.feed.instruction")} </i>}
        {f.mode === "sketch" && <i className="tag">{t("room.feed.sketch")}{f.text ? ": " : ""}</i>}
        {f.text}
      </span>
    );
  };

  return (
    <section className={"room-feed" + (open ? " open" : "")} data-testid="room-feed" aria-label={t("room.feed")}>
      <button className="head" aria-expanded={open} title={open ? t("room.feed.hide") : t("room.feed.show")} onClick={() => setOpen((v) => !v)}>
        <span>{t("room.feed")}</span>
        {unread > 0 && <b className="count" data-testid="room-feed-unread">{unread}</b>}
        <IconChevron up={!open} />
      </button>
      {open && (
        <div className="lines" ref={list} role="log" aria-live="polite">
          {!feed.length && <p className="empty">{t("room.feed.empty")}</p>}
          {feed.map((f) => (
            <p key={f.id} className={"line " + f.kind} style={{ "--who": f.color } as CSSProperties}>
              {f.kind !== "reset" && <b className="who">{f.by === me ? t("room.you") : f.name}</b>}
              {line(f)}
              <time>{hhmm(f.at)}</time>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
