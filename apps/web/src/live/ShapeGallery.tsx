import type { ReactNode } from "react";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n";

/** 48×32 thumbnail sketches in thin strokes: just enough to recognize a shape at a glance. */
export const T = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 48 32" width="100%" height="32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const SHAPE_OPTIONS: { value: string; thumb: ReactNode }[] = [
  {
    value: "auto",
    thumb: <T><path d="M24 6l2.2 5.8L32 14l-5.8 2.2L24 22l-2.2-5.8L16 14l5.8-2.2z" /><path d="M35 21l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1zM12 5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></T>,
  },
  {
    value: "mindmap",
    thumb: <T><ellipse cx="24" cy="16" rx="6" ry="4" /><path d="M18.5 14.5L10 8M18.5 17.5L10 24M29.5 14.5L38 8M29.5 17.5L38 24" /><circle cx="8" cy="7" r="2.5" /><circle cx="8" cy="25" r="2.5" /><circle cx="40" cy="7" r="2.5" /><circle cx="40" cy="25" r="2.5" /></T>,
  },
  {
    value: "flow",
    thumb: <T><rect x="2" y="11" width="10" height="10" rx="2" /><rect x="19" y="11" width="10" height="10" rx="2" /><rect x="36" y="11" width="10" height="10" rx="2" /><path d="M12 16h6M16 14l2 2-2 2M29 16h6M33 14l2 2-2 2" /></T>,
  },
  {
    value: "scale",
    thumb: <T><path d="M4 26h40" /><path d="M6 26v-4M16 26v-8M26 26v-13M36 26v-18" strokeWidth={4} /><path d="M38 6l4 0 0 4" /></T>,
  },
  {
    value: "cycle",
    thumb: <T><circle cx="24" cy="4.5" r="2.5" /><circle cx="35" cy="20" r="2.5" /><circle cx="13" cy="20" r="2.5" /><path d="M27 6.5q6 4 7.5 10.5M32 22.5q-8 5-16 0M11.5 17q1.5-6.5 9.5-10.5" /><path d="M33 15l1.5 2 1.5-2M18 21l-2 1.5 2 1.5M19 5l2 2-2.5 1" /></T>,
  },
  {
    value: "tree",
    thumb: <T><rect x="19" y="2" width="10" height="7" rx="1.5" /><path d="M24 9v4M10 13h28M10 13v4M24 13v4M38 13v4" /><rect x="5" y="17" width="10" height="7" rx="1.5" /><rect x="19" y="17" width="10" height="7" rx="1.5" /><rect x="33" y="17" width="10" height="7" rx="1.5" /></T>,
  },
  {
    value: "timeline",
    thumb: <T><path d="M3 16h42" /><circle cx="9" cy="16" r="2" /><circle cx="24" cy="16" r="2" /><circle cx="39" cy="16" r="2" /><path d="M9 13V7M24 19v6M39 13V7M5 6h8M20 26h8M35 6h8" /></T>,
  },
  {
    value: "system",
    thumb: <T><rect x="18" y="11" width="12" height="10" rx="2" /><rect x="3" y="3" width="9" height="7" rx="1.5" /><rect x="36" y="3" width="9" height="7" rx="1.5" /><rect x="3" y="22" width="9" height="7" rx="1.5" /><rect x="36" y="22" width="9" height="7" rx="1.5" /><path d="M12 8l6 5M36 8l-6 5M12 24l6-5M36 24l-6-5M7.5 10v12" /></T>,
  },
  {
    value: "list",
    thumb: <T><circle cx="10" cy="7" r="1.5" /><circle cx="10" cy="16" r="1.5" /><circle cx="10" cy="25" r="1.5" /><path d="M15 7h22M15 16h18M15 25h20" /></T>,
  },
  {
    value: "compare",
    thumb: <T><rect x="4" y="3" width="17" height="26" rx="2" /><rect x="27" y="3" width="17" height="26" rx="2" /><path d="M4 9h17M27 9h17M8 15h9M8 20h7M31 15h9M31 20h7" /></T>,
  },
];

interface Props {
  value: string;
  onChange(v: string): void;
}

/** Three-column gallery to pick the shape preference. */
export function ShapeGallery({ value, onChange }: Props) {
  const t = useT();
  const move = (i: number, d: number) => {
    const n = SHAPE_OPTIONS.length;
    const next = SHAPE_OPTIONS[(i + d + n) % n];
    onChange(next.value);
    document.querySelector<HTMLButtonElement>(`[data-shape="${next.value}"]`)?.focus();
  };
  return (
    <div className="shapes" role="radiogroup" aria-label={t("options.shape")} data-testid="shape">
      {SHAPE_OPTIONS.map((o, i) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={sel ? 0 : -1}
            data-shape={o.value}
            className={"shape" + (sel ? " sel" : "")}
            title={o.value}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const d = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }[e.key];
              if (d) { e.preventDefault(); move(i, d); }
            }}
          >
            {o.thumb}
            <span>{t(`shape.${o.value}` as MessageKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
