import { useEffect, useRef, useState } from "react";
import type { ProposalClick } from "@grafito/contract";
import { useT } from "../../i18n";

/** Space the toolbar takes, to keep it on screen. */
const SIZE = { w: 72, h: 36 };
const GAP = 6;

interface Props {
  proposal: string;
  /** Where the clicked item is on screen right now; null once it is gone or the proposal is closed. */
  anchor(): DOMRect | null;
  onDecide(type: ProposalClick["type"]): void;
  /** A turn is in flight: the buttons wait for it (a click then could not be replayed in its place). */
  busy: boolean;
  /** The anchor is gone. */
  onGone(): void;
}

/** The small floating ✓/✗ toolbar over a selected pencil item. It follows the item through pans, zooms and layout moves. */
export function ProposalToolbar({ proposal, anchor, onDecide, busy, onGone }: Props) {
  const t = useT();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const live = useRef({ anchor, onGone });
  live.current = { anchor, onGone };

  useEffect(() => {
    let raf = 0;
    const follow = () => {
      const r = live.current.anchor();
      if (!r) { live.current.onGone(); return; }
      // top-right corner of the item, flipped below it near the top edge
      const left = Math.round(Math.min(window.innerWidth - SIZE.w - GAP, Math.max(GAP, r.right - SIZE.w + GAP)));
      const top = Math.round(r.top - SIZE.h - GAP >= GAP ? r.top - SIZE.h - GAP : Math.min(window.innerHeight - SIZE.h - GAP, r.bottom + GAP));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [proposal]);

  // Keyboard users land on ✓; Tab reaches ✗, Escape closes.
  const shown = pos !== null;
  useEffect(() => { if (shown) ok.current?.focus({ preventScroll: true }); }, [proposal, shown]);

  if (!pos) return null;
  const hint = (label: string) => (busy ? t("architect.decide.wait") : label);
  return (
    <div className="decide" role="toolbar" aria-label={t("architect.decide.label", { proposal })} data-testid="decide-toolbar" style={pos}>
      <button ref={ok} type="button" className="ok" data-testid="decide-accept" disabled={busy} aria-label={t("architect.decide.accept")} title={hint(t("architect.decide.accept"))} onClick={() => onDecide("accept")}>✓</button>
      <button type="button" className="no" data-testid="decide-reject" disabled={busy} aria-label={t("architect.decide.reject")} title={hint(t("architect.decide.reject"))} onClick={() => onDecide("reject")}>✗</button>
    </div>
  );
}
