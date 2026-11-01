import { useEffect, useMemo, useRef, useState } from "react";
import type { Op } from "@grafito/contract";
import { createArchitectSession } from "../session";
import { t as translate, useT } from "../../i18n";

interface Props {
  board: { submit(ops: Op[]): Promise<void>; clear(): void };
}

/** Architect mode's controls: the one text box at the bottom. Mounting it starts a session on a blank board. */
export function ArchitectPanel({ board }: Props) {
  const t = useT();
  const boardRef = useRef(board);
  boardRef.current = board;
  const session = useMemo(
    () => createArchitectSession({
      board: { submit: (ops) => boardRef.current.submit(ops), clear: () => boardRef.current.clear() },
      zoneTitle: () => translate("architect.zoneTitle"),
    }),
    [],
  );
  useEffect(() => { session.start(); }, [session]);
  const [typed, setTyped] = useState("");

  return (
    <div className="architect" data-testid="architect-panel">
      <form className="typebar" data-testid="architect-typebar" onSubmit={(e) => e.preventDefault()}>
        <input data-testid="architect-input" aria-label={t("architect.input.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("architect.input.placeholder")} />
        <button className="pbtn primary" type="submit" disabled>{t("typebar.send")}</button>
      </form>
    </div>
  );
}
