import { useEffect, useMemo, useRef, useState } from "react";
import { findProposal, proposalItems } from "@grafito/board";
import type { Board } from "@grafito/board";
import { ARCHITECT_DEFAULT_MODEL } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { createArchitectSession, pickProposal } from "../session";
import type { ArchitectSessionState } from "../session";
import { loadCatalogs } from "../../live/catalogs";
import { fetchAvailableModels, usableModel } from "../../live/models";
import type { ModelControl } from "../../live/models";
import { t as translate, useLang, useT } from "../../i18n";
import { ProposalToolbar } from "./ProposalToolbar";

/** What the panel needs from the drawn board: clicks on it, the selection outline, and where an item is on screen. */
export interface BoardCanvas {
  /** Called with the pencil item a click lands on, or null (ink, paper); null unsets it. */
  onPick(fn: ((key: string | null) => void) | null): void;
  select(keys: readonly string[]): void;
  screenRect(key: string): DOMRect | null;
}

interface Props {
  board: { get(): Board; submit(ops: Op[]): Promise<void>; clear(): void };
  canvas: BoardCanvas;
  /** The model choice for the options popover, while this panel is mounted. */
  onModelControl(c: ModelControl | null): void;
}

/** Architect mode's controls: the speech bubble and the one text box. Mounting it starts a session on a blank board. */
export function ArchitectPanel({ board, canvas, onModelControl }: Props) {
  const t = useT();
  const lang = useLang();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [model, setModel] = useState(ARCHITECT_DEFAULT_MODEL);
  const deps = useRef({ board, canvas, model, lang });
  deps.current = { board, canvas, model, lang };
  const session = useMemo(
    () => createArchitectSession({
      board: { get: () => deps.current.board.get(), submit: (ops) => deps.current.board.submit(ops), clear: () => deps.current.board.clear() },
      // The icon catalogs are the live panel's setting, saved on every change.
      settings: { get: () => ({ model: deps.current.model, catalogs: loadCatalogs(), lang: deps.current.lang }) },
      zoneTitle: () => translate("architect.zoneTitle"),
    }),
    [],
  );
  const [state, setState] = useState<ArchitectSessionState>({ turns: [], busy: false, bubble: null, error: "", clicks: [] });
  useEffect(() => {
    const off = session.subscribe(setState);
    session.start();
    return () => { off(); session.stop(); };
  }, [session]);

  useEffect(() => {
    let alive = true;
    void fetchAvailableModels().then((ids) => { if (alive) setAvailable(ids); });
    return () => { alive = false; };
  }, []);
  // A choice the server does not offer falls back to architect mode's default.
  useEffect(() => { setModel((m) => usableModel(m, available, ARCHITECT_DEFAULT_MODEL)); }, [available]);
  useEffect(() => { onModelControl({ model, available, onModel: setModel }); }, [model, available, onModelControl]);
  useEffect(() => () => onModelControl(null), [onModelControl]);

  const [typed, setTyped] = useState("");
  const send = () => { if (session.send(typed)) setTyped(""); };
  const input = useRef<HTMLInputElement>(null);

  // The selected proposal, and the item clicked to select it (the toolbar sits by that one).
  const [sel, setSel] = useState<{ proposal: string; key: string } | null>(null);
  useEffect(() => {
    const c = deps.current.canvas;
    c.onPick((key) => {
      const pick = pickProposal(deps.current.board.get(), key);
      if (pick.do === "choose") session.decide("accept", pick.proposal);
      setSel(pick.do === "select" && key ? { proposal: pick.proposal, key } : null);
    });
    return () => { c.onPick(null); c.select([]); };
  }, [session]);
  useEffect(() => { deps.current.canvas.select(sel ? proposalItems(deps.current.board.get(), sel.proposal) : []); }, [sel]);
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);
  const decide = (type: "accept" | "reject") => {
    if (sel) session.decide(type, sel.proposal);
    setSel(null);
    input.current?.focus();
  };

  return (
    <div className="architect" data-testid="architect-panel">
      {(state.bubble || state.busy) && (
        <div className={"bubble" + (state.bubble ? "" : " wait")} data-testid="speech-bubble" role="status" aria-live="polite">
          {state.bubble ? state.bubble.text : t("architect.thinking")}
        </div>
      )}
      {sel && (
        <ProposalToolbar
          proposal={sel.proposal}
          anchor={() => (findProposal(deps.current.board.get(), sel.proposal) ? deps.current.canvas.screenRect(sel.key) : null)}
          onDecide={decide}
          onGone={() => setSel(null)}
        />
      )}
      {state.error && <div className="toasts"><div className="toast warn" data-testid="architect-error" role="alert">{state.error}</div></div>}
      <form className="typebar" data-testid="architect-typebar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={input} data-testid="architect-input" aria-label={t("architect.input.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("architect.input.placeholder")} />
        <button className="pbtn primary" type="submit" disabled={!typed.trim() || state.busy}>{t("typebar.send")}</button>
      </form>
    </div>
  );
}
