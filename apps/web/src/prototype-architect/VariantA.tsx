import { Bubbles } from "./Bubble";
import { Frame } from "./Frame";
import { PENDING, bbox, type Action, type BubbleDef, type State } from "./core";

/** A: click-first. Buttons in bubbles, hover check/cross on pencil, numbered dots, toggle button. */
export function VariantA({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const footer = (b: BubbleDef) =>
    b.actions === "approve" ? (
      <div className="pa-btns">
        <button className="pa-btn ok" onClick={() => dispatch({ t: "approve" })}>
          Approve
        </button>
        <button className="pa-btn no" onClick={() => dispatch({ t: "reject" })}>
          Reject
        </button>
      </div>
    ) : b.actions === "choose" ? (
      <div className="pa-btns">
        <button className="pa-btn ok" onClick={() => dispatch({ t: "choose", which: "A" })}>
          Choose A
        </button>
        <button className="pa-btn ok" onClick={() => dispatch({ t: "choose", which: "B" })}>
          Choose B
        </button>
      </div>
    ) : null;

  const pending = (PENDING[s.turn] ?? []).filter((g) => s.status[g] === "pencil");
  const isAlt = s.turn === 3;

  return (
    <>
      <button className="pa-toggle" onClick={() => dispatch({ t: "togglePast" })}>
        {s.showPast ? "Hide past bubbles" : "Show past bubbles"}
      </button>
      <Frame
        s={s}
        dispatch={dispatch}
        parse={false}
        placeholder={s.turn === 1 ? "Describe your app…" : "Use the buttons, or type a note"}
        overlay={
          <>
            {pending.map((g) => {
              const r = bbox([g]);
              const other = g === "altA" ? "B" : "A";
              const mine = g === "altA" ? "A" : "B";
              return (
                <div key={g} className="pa-hit" style={{ left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12 }}>
                  <span className="pa-mini">
                    <button title={isAlt ? `Choose ${mine}` : "Approve"} className="ok" onClick={() => dispatch(isAlt ? { t: "choose", which: mine } : { t: "approve" })}>
                      ✓
                    </button>
                    <button title={isAlt ? `Choose ${other} instead` : "Reject"} className="no" onClick={() => dispatch(isAlt ? { t: "choose", which: other } : { t: "reject" })}>
                      ✗
                    </button>
                  </span>
                </div>
              );
            })}
            <Bubbles
              s={s}
              dispatch={dispatch}
              footer={footer}
              marker={(b, reopen) => (
                <button className="pa-dot" style={{ left: b.dot[0] - 11, top: b.dot[1] - 11 }} title={b.text} onClick={reopen}>
                  {b.turn}
                </button>
              )}
            />
          </>
        }
      />
    </>
  );
}
