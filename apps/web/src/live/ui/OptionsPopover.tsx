import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { ShapeGallery } from "./ShapeGallery";
import { CatalogTiles, LangTiles, ModelTiles, ViewTiles } from "./OptionTiles";
import { isLang, setLang, useLang, useT } from "../../i18n";

interface Props {
  open: boolean;
  /** The button that opens it: clicks on it do not count as outside. */
  anchor: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  model: string;
  onModel(v: string): void;
  shape: string;
  onShape(v: string): void;
  catalogs: string[];
  onCatalogs(v: string[]): void;
  /** The language cannot change while the mic listens in the old one. */
  langLocked: boolean;
  follow: boolean;
  onFollow(v: boolean): void;
  showTranscript: boolean;
  onShowTranscript(v: boolean): void;
}

export function OptionsPopover({ open, anchor, onClose, model, onModel, shape, onShape, catalogs, onCatalogs, langLocked, follow, onFollow, showTranscript, onShowTranscript }: Props) {
  const t = useT();
  const lang = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const n = e.target as Node;
      if (ref.current?.contains(n) || anchor.current?.contains(n)) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { close.current(); anchor.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, anchor]);

  return (
    <div className="popover" ref={ref} role="dialog" aria-label={t("toolbar.options")} hidden={!open}>
      <div className="field">
        {t("options.model")}
        <ModelTiles value={model} onChange={onModel} />
      </div>
      <div className="field">
        {t("options.shape")}
        <ShapeGallery value={shape} onChange={onShape} />
      </div>
      <div className="field">
        {t("options.icons")}
        <CatalogTiles value={catalogs} onChange={onCatalogs} />
      </div>
      <div className="field">
        {t("options.language")}
        <LangTiles value={lang} onChange={(v) => { if (isLang(v)) setLang(v); }} disabled={langLocked} />
      </div>
      <div className="field">
        {t("options.view")}
        <ViewTiles follow={follow} onFollow={onFollow} showTranscript={showTranscript} onShowTranscript={onShowTranscript} />
      </div>
    </div>
  );
}
