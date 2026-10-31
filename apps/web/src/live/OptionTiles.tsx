import type { ReactNode } from "react";
import { T } from "./ShapeGallery";
import { ICONOS_AWS } from "../iconos/aws";
import { AWS_SERVICES } from "@grafito/icons";

interface Tile { value: string; label: string; sub?: string; thumb: ReactNode }

/** Código de país grande en el área de la miniatura. */
const Code = ({ children }: { children: string }) => (
  <T><text x="24" y="23" textAnchor="middle" fontSize="18" fontWeight="600" fill="currentColor" stroke="none" fontFamily="inherit">{children}</text></T>
);

const MODEL_TILES: Tile[] = [
  {
    value: "claude-sonnet-5-5", label: "Sonnet 5.5", sub: "Mejor",
    thumb: <T><path d="M24 3l3.2 9L36 15l-8.8 3L24 27l-3.2-9L12 15l8.8-3z" /><path d="M39 20l1.2 3.3 3.3 1.2-3.3 1.2L39 29l-1.2-3.3-3.3-1.2 3.3-1.2zM9 19l.9 2.4 2.4.9-2.4.9L9 26l-.9-2.4-2.4-.9 2.4-.9z" /></T>,
  },
  {
    value: "claude-haiku-5-5", label: "Haiku 5.5", sub: "Más rápido",
    thumb: <T><path d="M27 3L14 18h9l-3 11 14-16h-9z" /><path d="M6 10h5M4 17h6M7 24h4" /></T>,
  },
];

const LANG_TILES: Tile[] = [
  { value: "es-CL", label: "Chile", thumb: <Code>CL</Code> },
  { value: "es-AR", label: "Argentina", thumb: <Code>AR</Code> },
  { value: "es-MX", label: "México", thumb: <Code>MX</Code> },
  { value: "es-ES", label: "España", thumb: <Code>ES</Code> },
  { value: "en-US", label: "English US", thumb: <Code>US</Code> },
];

interface RadioProps {
  tiles: Tile[];
  value: string;
  onChange(v: string): void;
  label: string;
  cols?: number;
  disabled?: boolean;
  testid?: string;
}

/** Grupo de baldosas de elección única, mismo patrón que ShapeGallery. */
function RadioTiles({ tiles, value, onChange, label, cols = 3, disabled, testid }: RadioProps) {
  const move = (i: number, d: number) => {
    const n = tiles.length;
    const next = tiles[(i + d + n) % n];
    onChange(next.value);
    document.querySelector<HTMLButtonElement>(`[data-tile="${label}-${next.value}"]`)?.focus();
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
            data-tile={`${label}-${o.value}`}
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

export const ModelTiles = ({ value, onChange }: { value: string; onChange(v: string): void }) => (
  <RadioTiles tiles={MODEL_TILES} value={value} onChange={onChange} label="Modelo" cols={2} />
);

export const LangTiles = ({ value, onChange, disabled }: { value: string; onChange(v: string): void; disabled?: boolean }) => (
  <RadioTiles tiles={LANG_TILES} value={value} onChange={onChange} label="Idioma" disabled={disabled} testid="lang" />
);

interface ViewProps {
  follow: boolean;
  onFollow(v: boolean): void;
  showTranscript: boolean;
  onShowTranscript(v: boolean): void;
}

/** Dos interruptores independientes en forma de baldosa. */
export function ViewTiles({ follow, onFollow, showTranscript, onShowTranscript }: ViewProps) {
  const toggles = [
    {
      label: "Seguir cámara", on: follow, set: onFollow, id: undefined as string | undefined,
      thumb: <T><rect x="6" y="9" width="36" height="19" rx="3" /><path d="M17 9l2-4h10l2 4" /><circle cx="24" cy="18.5" r="5.5" /></T>,
    },
    {
      label: "Mostrar transcripción", on: showTranscript, set: onShowTranscript, id: "show-transcript",
      thumb: <T><rect x="4" y="5" width="40" height="22" rx="3" /><path d="M10 16h14M28 16h10M14 21h20" /></T>,
    },
  ];
  return (
    <div className="shapes" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
      {toggles.map((t) => (
        <button key={t.label} type="button" aria-pressed={t.on} data-testid={t.id} className={"shape" + (t.on ? " sel" : "")} onClick={() => t.set(!t.on)}>
          {t.thumb}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

interface Catalog { id: string; label: string; title: string; samples: string[] }

/** Un catálogo de iconos por tarjeta; más catálogos = más entradas aquí. */
const CATALOGS: Catalog[] = [
  { id: "aws", label: "AWS", title: `Lambda, S3, Cognito… ${AWS_SERVICES.length} servicios`, samples: ["lambda", "s3", "dynamodb"] },
];

/** Tarjetas independientes (varias pueden ir prendidas); value = ids de catálogos prendidos. */
export function CatalogTiles({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  return (
    <div className="shapes" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} data-testid="catalogs">
      {CATALOGS.map((c) => {
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
              {c.samples.map((s) => <i key={s} dangerouslySetInnerHTML={{ __html: ICONOS_AWS[s] ?? "" }} />)}
            </span>
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
