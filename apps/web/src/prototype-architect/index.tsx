import { useEffect, useReducer, useState } from "react";
import "./proto.css";
import { ELEMENTS, TURN_LABEL, BUBBLES, bubbleState, initial, reduce, type State, type VariantId } from "./core";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

const VARIANTS: { id: VariantId; label: string }[] = [
  { id: "A", label: "A · Click-first" },
  { id: "B", label: "B · Text-first" },
  { id: "C", label: "C · Both, quiet" },
];

function readVariant(): VariantId {
  const v = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return v === "B" || v === "C" ? v : "A";
}

export function ArchitectPrototype() {
  const [s, dispatch] = useReducer(reduce, undefined, initial);
  const [variant, setVariant] = useState<VariantId>(readVariant);
  const [panel, setPanel] = useState(false);

  const go = (id: VariantId) => {
    setVariant(id);
    const u = new URL(location.href);
    u.searchParams.set("variant", id);
    history.replaceState(null, "", u);
  };
  const step = (d: number) => go(VARIANTS[(VARIANTS.findIndex((v) => v.id === variant) + d + VARIANTS.length) % VARIANTS.length]!.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pa-root">
      <div className="pa-top">
        <button className="pa-pill" onClick={() => dispatch({ t: "reset" })}>
          Reset
        </button>
        <button className="pa-pill" onClick={() => setPanel(!panel)}>
          State {panel ? "▾" : "▸"}
        </button>
        <span className="pa-proto">throwaway prototype #36</span>
      </div>
      {panel && <StatePanel s={s} />}
      {variant === "A" && <VariantA s={s} dispatch={dispatch} />}
      {variant === "B" && <VariantB s={s} dispatch={dispatch} />}
      {variant === "C" && <VariantC s={s} dispatch={dispatch} />}
      <div className="pa-switch">
        <button onClick={() => step(-1)} aria-label="Previous variant">
          ←
        </button>
        <span>{VARIANTS.find((v) => v.id === variant)!.label}</span>
        <button onClick={() => step(1)} aria-label="Next variant">
          →
        </button>
      </div>
    </div>
  );
}

function StatePanel({ s }: { s: State }) {
  return (
    <div className="pa-panel">
      <b>Turn {s.turn}</b> <small>{TURN_LABEL[s.turn]}</small>
      <h4>Elements</h4>
      {ELEMENTS.map((e) => (
        <div key={e.id}>
          {e.id} <i className={`st ${s.status[e.grp] ?? "none"}`}>{s.status[e.grp] ?? "-"}</i>
        </div>
      ))}
      <h4>Bubbles</h4>
      {BUBBLES.map((b) => (
        <div key={b.id}>
          {b.id} <i className={`st ${bubbleState(b, s)}`}>{bubbleState(b, s)}</i>
        </div>
      ))}
      <h4>UI</h4>
      <div>show past: {String(s.showPast)}</div>
      <div>selected: {s.selected ?? "-"}</div>
    </div>
  );
}
