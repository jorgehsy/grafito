import { useEffect, useRef, useState } from "react";
import type { Finding } from "@grafito/board";
import { PIN, pinSpot } from "../review";
import { useT } from "../../i18n";

interface Props {
  /** The open findings as the panel numbers them. */
  findings: readonly { n: number; finding: Finding }[];
  /** The render keys a finding points at now; [] when it has no item on the board. */
  keysOf(f: Finding): readonly string[];
  screenRect(key: string): DOMRect | null;
  selected: string | null;
  onSelect(id: string): void;
}

interface Spot { id: string; n: number; severity: Finding["severity"]; text: string; left: number; top: number }

/**
 * One numbered pin per finding, on the corner of the item it is about, while the review panel is open. Like the
 * ✓/✗ toolbar the pins are re-placed every frame, so they follow pans, zooms and layout moves; a finding whose item
 * is gone or off screen has no pin.
 */
export function FindingPins({ findings, keysOf, screenRect, selected, onSelect }: Props) {
  const t = useT();
  const [spots, setSpots] = useState<Spot[]>([]);
  const live = useRef({ findings, keysOf, screenRect });
  live.current = { findings, keysOf, screenRect };

  useEffect(() => {
    let raf = 0;
    let last = "";
    const frame = () => {
      const cur = live.current;
      const next: Spot[] = [];
      const perItem = new Map<string, number>();
      for (const { n, finding: f } of cur.findings) {
        const key = cur.keysOf(f)[0];
        const r = key ? cur.screenRect(key) : null;
        if (!key || !r || r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) continue;
        const nth = perItem.get(key) ?? 0;
        perItem.set(key, nth + 1);
        next.push({ id: f.id, n, severity: f.severity, text: f.text, ...pinSpot(r, nth) });
      }
      const sig = JSON.stringify(next);
      if (sig !== last) { last = sig; setSpots(next); }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="rv-pins" data-testid="finding-pins">
      {spots.map((s) => (
        <button
          key={s.id} type="button" className={"rv-pin sev-" + s.severity + (selected === s.id ? " on" : "")} data-testid={`pin-${s.id}`}
          style={{ left: s.left, top: s.top, width: PIN, height: PIN }} aria-label={t("architect.review.pin", { n: s.n, text: s.text })} title={s.text}
          onClick={() => onSelect(s.id)}
        >
          {s.n}
        </button>
      ))}
    </div>
  );
}
