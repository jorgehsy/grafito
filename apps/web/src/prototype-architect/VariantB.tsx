import { useEffect } from "react";
import { Bubbles } from "./Bubble";
import { Frame } from "./Frame";
import type { Action, BubbleDef, State } from "./core";

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

/** B: text-first. No buttons. Hint in the bubble, margin icons, B key and a small icon toggle. */
export function VariantB({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "b") dispatch({ t: "togglePast" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const hints: Record<number, string> = { 1: "Describe your app…", 2: "yes / no", 3: "A or B", 4: "yes / no" };
  return (
    <Frame
      s={s}
      dispatch={dispatch}
      parse
      placeholder={hints[s.turn] ?? ""}
      note="Esc leaves the box, then B shows or hides past bubbles"
      inputLead={
        <button type="button" className={`pa-lead ${s.showPast ? "on" : ""}`} title="Past bubbles (B)" onClick={() => dispatch({ t: "togglePast" })}>
          <Icon />
        </button>
      }
      overlay={
        <Bubbles
          s={s}
          dispatch={dispatch}
          footer={(b: BubbleDef) => <div className="pa-hint">{b.hint}</div>}
          marker={(b, reopen) => (
            <button className="pa-margin" style={{ left: 14, top: b.row - 12 }} title={b.text} onClick={reopen}>
              <Icon />
            </button>
          )}
        />
      }
    />
  );
}

function Icon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M3 4h14v9H9l-4 3.5V13H3z" />
    </svg>
  );
}
