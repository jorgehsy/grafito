import { useEffect, useRef, useState, type ReactNode } from "react";
import { Board } from "./Board";
import { STAGE, type Action, type State } from "./core";

function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ k: 1, x: 0, y: 0 });
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    const run = () => {
      const k = Math.min(1.2, e.clientWidth / STAGE.w, e.clientHeight / STAGE.h);
      setFit({ k, x: (e.clientWidth - STAGE.w * k) / 2, y: (e.clientHeight - STAGE.h * k) / 2 });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(e);
    return () => ro.disconnect();
  }, []);
  return { ref, fit };
}

export function Frame({
  s,
  dispatch,
  parse,
  overlay,
  rail,
  inputLead,
  placeholder,
  note,
}: {
  s: State;
  dispatch: (a: Action) => void;
  parse: boolean;
  overlay: ReactNode;
  rail?: ReactNode;
  inputLead?: ReactNode;
  placeholder: string;
  note?: string;
}) {
  const { ref, fit } = useFit();
  const [text, setText] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({ t: "text", text, parse });
    setText("");
  };
  return (
    <>
      <div className="pa-wrap" ref={ref}>
        <div className="pa-stage" style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.k})` }}>
          <Board status={s.status} />
          {overlay}
        </div>
      </div>
      {rail}
      <form className="pa-input" onSubmit={submit}>
        {inputLead}
        <input
          key={s.nudge}
          className={s.nudge ? "nudge" : ""}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={s.turn >= 5 ? "Done. Press Reset to replay." : placeholder}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        />
        <button type="submit" aria-label="Send">
          ↵
        </button>
      </form>
      {note && <div className="pa-note">{note}</div>}
    </>
  );
}
