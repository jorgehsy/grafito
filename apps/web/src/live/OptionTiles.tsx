import type { ReactNode } from "react";
import { T } from "./ShapeGallery";
import { AWS_ICONS } from "../icons/aws";
import { AWS_SERVICES } from "@grafito/icons";
import { LANGS, useT } from "../i18n";

interface Tile { value: string; label: string; sub?: string; thumb: ReactNode }

/** Large country code filling the thumbnail area. */
const Code = ({ children }: { children: string }) => (
  <T><text x="24" y="23" textAnchor="middle" fontSize="18" fontWeight="600" fill="currentColor" stroke="none" fontFamily="inherit">{children}</text></T>
);

const modelTiles = (t: ReturnType<typeof useT>): Tile[] => [
  {
    value: "claude-sonnet-5-5", label: "Sonnet 5.5", sub: t("options.model.best"),
    thumb: <T><path d="M24 3l3.2 9L36 15l-8.8 3L24 27l-3.2-9L12 15l8.8-3z" /><path d="M39 20l1.2 3.3 3.3 1.2-3.3 1.2L39 29l-1.2-3.3-3.3-1.2 3.3-1.2zM9 19l.9 2.4 2.4.9-2.4.9L9 26l-.9-2.4-2.4-.9 2.4-.9z" /></T>,
  },
  {
    value: "claude-haiku-5-5", label: "Haiku 5.5", sub: t("options.model.faster"),
    thumb: <T><path d="M27 3L14 18h9l-3 11 14-16h-9z" /><path d="M6 10h5M4 17h6M7 24h4" /></T>,
  },
];

const LANG_TILES: Tile[] = LANGS.map((l) => ({ value: l.code, label: l.short, thumb: <Code>{l.code.split("-")[1]}</Code> }));

interface RadioProps {
  tiles: Tile[];
  value: string;
  onChange(v: string): void;
  /** Accessible name of the group. */
  label: string;
  /** Stable id used for the tile `data-tile` attributes. */
  id: string;
  cols?: number;
  disabled?: boolean;
  testid?: string;
}

/** Single-choice tile group, same pattern as ShapeGallery. */
function RadioTiles({ tiles, value, onChange, label, id, cols = 3, disabled, testid }: RadioProps) {
  const move = (i: number, d: number) => {
    const n = tiles.length;
    const next = tiles[(i + d + n) % n];
    onChange(next.value);
    document.querySelector<HTMLButtonElement>(`[data-tile="${id}-${next.value}"]`)?.focus();
  };
  return (
    <div className="shapes" role="radiogroup" aria-label={label} data-testid={testid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {tiles.map((o, i) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={sel ? 0 : -1}
            disabled={disabled}
            data-tile={`${id}-${o.value}`}
            className={"shape" + (sel ? " sel" : "")}
            title={o.value}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const d = { ArrowRight: 1, ArrowDown: cols, ArrowLeft: -1, ArrowUp: -cols }[e.key];
              if (d) { e.preventDefault(); move(i, d); }
            }}
          >
            {o.thumb}
            <span>{o.label}</span>
            {o.sub && <small>{o.sub}</small>}
          </button>
        );
      })}
    </div>
  );
}

export function ModelTiles({ value, onChange }: { value: string; onChange(v: string): void }) {
  const t = useT();
  return <RadioTiles tiles={modelTiles(t)} value={value} onChange={onChange} label={t("options.model")} id="model" cols={2} />;
}

export function LangTiles({ value, onChange, disabled }: { value: string; onChange(v: string): void; disabled?: boolean }) {
  const t = useT();
  return <RadioTiles tiles={LANG_TILES} value={value} onChange={onChange} label={t("options.language")} id="lang" disabled={disabled} testid="lang" />;
}

interface ViewProps {
  follow: boolean;
  onFollow(v: boolean): void;
  showTranscript: boolean;
  onShowTranscript(v: boolean): void;
}

/** Two independent toggles shaped as tiles. */
export function ViewTiles({ follow, onFollow, showTranscript, onShowTranscript }: ViewProps) {
  const t = useT();
  const toggles = [
    {
      label: t("options.view.follow"), on: follow, set: onFollow, id: undefined as string | undefined,
      thumb: <T><rect x="6" y="9" width="36" height="19" rx="3" /><path d="M17 9l2-4h10l2 4" /><circle cx="24" cy="18.5" r="5.5" /></T>,
    },
    {
      label: t("options.view.transcript"), on: showTranscript, set: onShowTranscript, id: "show-transcript",
      thumb: <T><rect x="4" y="5" width="40" height="22" rx="3" /><path d="M10 16h14M28 16h10M14 21h20" /></T>,
    },
  ];
  return (
    <div className="shapes" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
      {toggles.map((tg) => (
        <button key={tg.label} type="button" aria-pressed={tg.on} data-testid={tg.id} className={"shape" + (tg.on ? " sel" : "")} onClick={() => tg.set(!tg.on)}>
          {tg.thumb}
          <span>{tg.label}</span>
        </button>
      ))}
    </div>
  );
}

interface Catalog { id: string; label: string; title: string; samples: string[] }

/** One icon catalog per card; more catalogs means more entries here. */
const catalogs = (t: ReturnType<typeof useT>): Catalog[] => [
  { id: "aws", label: "AWS", title: t("options.catalog.aws", { count: AWS_SERVICES.length }), samples: ["lambda", "s3", "dynamodb"] },
];

/** Independent cards (several can be on); value = ids of the enabled catalogs. */
export function CatalogTiles({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const t = useT();
  return (
    <div className="shapes" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} data-testid="catalogs">
      {catalogs(t).map((c) => {
        const on = value.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            data-testid={`catalog-${c.id}`}
            title={c.title}
            className={"shape catalog" + (on ? " sel on" : "")}
            onClick={() => onChange(on ? value.filter((x) => x !== c.id) : [...value, c.id])}
          >
            <span className="samples" aria-hidden="true">
              {c.samples.map((s) => <i key={s} dangerouslySetInnerHTML={{ __html: AWS_ICONS[s] ?? "" }} />)}
            </span>
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
