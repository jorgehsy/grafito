import { useEffect } from "react";
import { Bubbles } from "./Bubble";
import { Frame } from "./Frame";
import { BUBBLES, PENDING, bbox, bubbleState, type Action, type BubbleDef, type State } from "./core";

/** C: both, quiet. Text like B, plus click to select (toolbar) or click an alternative. Timeline rail. */
export function VariantC({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const pending = (PENDING[s.turn] ?? []).filter((g) => s.status[g] === "pencil");
  const isAlt = s.turn === 3;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ t: "select", grp: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const past = BUBBLES.filter((b) => b.turn < s.turn);
  const hints: Record<number, string> = { 1: "Describe your app…", 2: "yes / no, or click the sketch", 3: "A or B, or click one", 4: "yes / no, or click the sketch" };

  return (
    <Frame
      s={s}
      dispatch={dispatch}
      parse
      placeholder={hints[s.turn] ?? ""}
      rail={
        <div className={`pa-rail ${s.showPast ? "open" : ""}`} onClick={() => dispatch({ t: "togglePast" })} title="Click to expand or collapse all past bubbles">
          <span className="lbl">history</span>
          {past.length === 0 && <span className="empty">nothing yet</span>}
          {past.map((b) => (
            <button
              key={b.id}
              className={`pa-rdot ${bubbleState(b, s) === "open" ? "on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ t: "toggleOpen", id: b.id });
              }}
            >
              <i />
              <span className="tip">
                {b.turn}. {b.text}
              </span>
            </button>
          ))}
        </div>
      }
      overlay={
        <>
          {pending.map((g) => {
            const r = bbox([g]);
            const sel = s.selected === g && !isAlt;
            const mine = g === "altA" ? "A" : "B";
            return (
              <div key={g}>
                <div
                  className={`pa-hit c ${sel ? "sel" : ""}`}
                  style={{ left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12 }}
                  title={isAlt ? `Choose ${mine}` : "Select"}
                  onClick={() => (isAlt ? dispatch({ t: "choose", which: mine }) : dispatch({ t: "select", grp: sel ? null : g }))}
                />
                {sel && (
                  <span className="pa-tool" style={{ left: r.x + r.w - 40, top: r.y - 40 }}>
                    <button className="ok" title="Approve" onClick={() => dispatch({ t: "approve" })}>
                      ✓
                    </button>
                    <button className="no" title="Reject" onClick={() => dispatch({ t: "reject" })}>
                      ✗
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          <Bubbles s={s} dispatch={dispatch} footer={(b: BubbleDef) => <div className="pa-hint">{b.actions ? `${b.hint}, or click` : b.hint}</div>} marker={() => null} />
        </>
      }
    />
  );
}
