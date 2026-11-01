import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BUBBLES, bubbleState, tipFor, type Action, type BubbleDef, type State } from "./core";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function Bubble({ b, past, footer, onClick }: { b: BubbleDef; past: boolean; footer?: ReactNode; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: b.w, h: 110 });
  useLayoutEffect(() => {
    const e = ref.current;
    if (!e) return;
    const measure = () => setSize((p) => (p.w === e.offsetWidth && p.h === e.offsetHeight ? p : { w: e.offsetWidth, h: e.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(e);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const [tx, ty] = tipFor(b, b.x + w / 2, b.y + h / 2);
  const lx = tx - b.x;
  const ly = ty - b.y;
  const dx = lx - w / 2;
  const dy = ly - h / 2;
  const horizontal = Math.abs(dx) * h > Math.abs(dy) * w;
  let poly: string;
  let cover: [number, number, number, number];
  if (horizontal) {
    const ex = dx > 0 ? w : 0;
    const inner = dx > 0 ? w - 3 : 3;
    const by = clamp(ly, 26, h - 26);
    poly = `${inner},${by - 12} ${inner},${by + 12} ${lx},${ly}`;
    cover = [ex, by - 10, ex, by + 10];
  } else {
    const ey = dy > 0 ? h : 0;
    const inner = dy > 0 ? h - 3 : 3;
    const bx = clamp(lx, 26, w - 26);
    poly = `${bx - 12},${inner} ${bx + 12},${inner} ${lx},${ly}`;
    cover = [bx - 10, ey, bx + 10, ey];
  }

  return (
    <div
      ref={ref}
      className={`pa-bubble ${b.kind} ${past ? "past" : "now"}`}
      style={{ left: b.x, top: b.y, width: b.w, zIndex: past ? 30 : 20 }}
      onClick={onClick}
    >
      <svg className="pa-tail" width="1" height="1">
        <polygon points={poly} />
      </svg>
      <div className="pa-bubble-box">
        <div className="pa-who">Claude · turn {b.turn}</div>
        <p>{b.text}</p>
        {footer}
      </div>
      <svg className="pa-tail cover" width="1" height="1">
        <line x1={cover[0]} y1={cover[1]} x2={cover[2]} y2={cover[3]} />
      </svg>
    </div>
  );
}

/** Renders every bubble that is open or a marker. Variants supply footer and marker. */
export function Bubbles({
  s,
  dispatch,
  footer,
  marker,
}: {
  s: State;
  dispatch: (a: Action) => void;
  footer: (b: BubbleDef) => ReactNode;
  marker: (b: BubbleDef, reopen: () => void) => ReactNode;
}) {
  return (
    <>
      {BUBBLES.map((b) => {
        const st = bubbleState(b, s);
        if (st === "hidden") return null;
        const toggle = () => dispatch({ t: "toggleOpen", id: b.id });
        if (st === "marker") return <span key={b.id}>{marker(b, toggle)}</span>;
        const past = b.turn !== s.turn;
        return <Bubble key={b.id} b={b} past={past} footer={past ? null : footer(b)} onClick={past && !s.showPast ? toggle : undefined} />;
      })}
    </>
  );
}
