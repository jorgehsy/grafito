import { useEffect, useRef, useState } from "react";
import type { Board } from "@grafito/board";
import { placeBubble, resolveTarget, tailShape, tailTip, unionRect } from "../bubbles";
import type { BubbleMarker, Rect } from "../bubbles";
import type { Bubble } from "../session";
import { useT } from "../../i18n";

/** Fixed screen parts a bubble must not cover: the ✓/✗ toolbar, the rail and text box, the side toolbar, the brand. */
const AVOID = ".decide, .architect .trail, .architect .typebar, nav.toolbar, header.brand";
/** Room kept around what a bubble avoids, other bubbles included. */
const PAD = 8;

interface Placed {
  x: number;
  y: number;
  tail: ReturnType<typeof tailShape>;
}

interface Props {
  /** The open bubbles, newest first: the current turn's, then reopened past ones. */
  bubbles: readonly (BubbleMarker & { bubble: Bubble })[];
  current: number;
  /** A turn is in flight and has no bubble yet: a general "Thinking…" bubble. */
  waiting: boolean;
  board(): Board;
  screenRect(key: string): DOMRect | null;
}

const toRect = (r: DOMRect, pad = 0): Rect => ({ x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad });
const onScreen = (r: Rect) => r.x + r.w > 0 && r.y + r.h > 0 && r.x < window.innerWidth && r.y < window.innerHeight;

/**
 * The speech bubbles over the board. A bubble with a target sits beside it with a tail pointing at it, and follows it
 * through pans, zooms and layout moves (re-placed every frame, like the ✓/✗ toolbar); one without a target, or whose
 * target is gone or off screen, sits in the top-right corner.
 */
export function SpeechBubbles({ bubbles, current, waiting, board, screenRect }: Props) {
  const t = useT();
  const els = useRef(new Map<number | "wait", HTMLDivElement>());
  const [placed, setPlaced] = useState<Record<string, Placed>>({});
  const live = useRef({ bubbles, waiting, board, screenRect });
  live.current = { bubbles, waiting, board, screenRect };

  useEffect(() => {
    let raf = 0;
    let last = "";
    const frame = () => {
      const { bubbles: open, waiting: wait, board: getBoard, screenRect: rectOf } = live.current;
      const screen = { w: window.innerWidth, h: window.innerHeight };
      const avoid = [...document.querySelectorAll(AVOID)].map((e) => toRect(e.getBoundingClientRect(), PAD)).filter((r) => r.w > 2 * PAD);
      const b = getBoard();
      const others = (keys: readonly string[]) =>
        b.elements.filter((e) => !keys.includes(e.id)).map((e) => rectOf(e.id)).filter((r): r is DOMRect => !!r).map((r) => toRect(r));
      const next: Record<string, Placed> = {};
      const items: { id: number | "wait"; target?: string }[] = [...(wait ? [{ id: "wait" as const }] : []), ...open.map((m) => ({ id: m.turn, target: m.bubble.target }))];
      for (const it of items) {
        const el = els.current.get(it.id);
        if (!el) continue;
        const size = { w: el.offsetWidth, h: el.offsetHeight };
        const target = resolveTarget(b, it.target);
        const rects = target ? target.keys.map(rectOf).filter((r): r is DOMRect => !!r && r.width > 0).map((r) => toRect(r)) : [];
        const box = unionRect(rects);
        const aim = box && onScreen(box) ? box : null;
        const pos = placeBubble(size, aim, screen, avoid, aim && target ? others(target.keys) : []);
        const tail = aim && target ? tailShape({ ...pos, ...size }, tailTip(target.kind, aim, { ...pos, ...size })) : null;
        next[String(it.id)] = { x: Math.round(pos.x), y: Math.round(pos.y), tail };
        avoid.push({ x: pos.x - PAD, y: pos.y - PAD, w: size.w + 2 * PAD, h: size.h + 2 * PAD });
      }
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setPlaced(next); }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  const ref = (id: number | "wait") => (el: HTMLDivElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); };
  const style = (id: number | "wait") => {
    const p = placed[String(id)];
    return p ? { left: p.x, top: p.y } : { left: 0, top: 0, visibility: "hidden" as const };
  };

  return (
    <>
      {waiting && (
        <div ref={ref("wait")} className="bubble general wait" data-testid="speech-bubble" role="status" aria-live="polite" style={style("wait")}>
          <div className="box">{t("architect.thinking")}</div>
        </div>
      )}
      {bubbles.map((m) => {
        const now = m.turn === current;
        const p = placed[String(m.turn)];
        return (
          <div
            key={m.turn}
            ref={ref(m.turn)}
            className={"bubble" + (now ? "" : " past") + (p?.tail ? " pointing" : " general")}
            data-testid={now ? "speech-bubble" : "past-bubble"}
            data-turn={m.turn}
            data-target={p?.tail ? m.bubble.target : undefined}
            {...(now ? { role: "status", "aria-live": "polite" as const } : {})}
            style={style(m.turn)}
          >
            {p?.tail && (
              <svg className="tail" width="1" height="1" aria-hidden="true">
                <polygon points={p.tail.points.map((q) => q.join(",")).join(" ")} />
              </svg>
            )}
            <div className="box">
              {!now && <div className="who">{t("architect.bubble.turn", { n: m.turn })}</div>}
              {m.bubble.text}
            </div>
            {p?.tail && (
              <svg className="tail cover" width="1" height="1" aria-hidden="true">
                <line x1={p.tail.cover[0]} y1={p.tail.cover[1]} x2={p.tail.cover[2]} y2={p.tail.cover[3]} />
              </svg>
            )}
          </div>
        );
      })}
    </>
  );
}
