import { useEffect, useMemo, useRef, useState } from "react";
import type { Board } from "@grafito/board";
import { ARCHITECT_DEFAULT_MODEL } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { createArchitectSession } from "../session";
import type { ArchitectSessionState } from "../session";
import { loadCatalogs } from "../../live/catalogs";
import { fetchAvailableModels, usableModel } from "../../live/models";
import type { ModelControl } from "../../live/models";
import { t as translate, useLang, useT } from "../../i18n";

interface Props {
  board: { get(): Board; submit(ops: Op[]): Promise<void>; clear(): void };
  /** The model choice for the options popover, while this panel is mounted. */
  onModelControl(c: ModelControl | null): void;
}

/** Architect mode's controls: the speech bubble and the one text box. Mounting it starts a session on a blank board. */
export function ArchitectPanel({ board, onModelControl }: Props) {
  const t = useT();
  const lang = useLang();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [model, setModel] = useState(ARCHITECT_DEFAULT_MODEL);
  const deps = useRef({ board, model, lang });
  deps.current = { board, model, lang };
  const session = useMemo(
    () => createArchitectSession({
      board: { get: () => deps.current.board.get(), submit: (ops) => deps.current.board.submit(ops), clear: () => deps.current.board.clear() },
      // The icon catalogs are the live panel's setting, saved on every change.
      settings: { get: () => ({ model: deps.current.model, catalogs: loadCatalogs(), lang: deps.current.lang }) },
      zoneTitle: () => translate("architect.zoneTitle"),
    }),
    [],
  );
  const [state, setState] = useState<ArchitectSessionState>({ turns: [], busy: false, bubble: null, error: "" });
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

  return (
    <div className="architect" data-testid="architect-panel">
      {(state.bubble || state.busy) && (
        <div className={"bubble" + (state.bubble ? "" : " wait")} data-testid="speech-bubble" role="status" aria-live="polite">
          {state.bubble ? state.bubble.text : t("architect.thinking")}
        </div>
      )}
      {state.error && <div className="toasts"><div className="toast warn" data-testid="architect-error" role="alert">{state.error}</div></div>}
      <form className="typebar" data-testid="architect-typebar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input data-testid="architect-input" aria-label={t("architect.input.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("architect.input.placeholder")} />
        <button className="pbtn primary" type="submit" disabled={!typed.trim() || state.busy}>{t("typebar.send")}</button>
      </form>
    </div>
  );
}
