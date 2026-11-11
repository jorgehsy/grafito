import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyReview, findProposal, proposalItems, reviewIsEmpty } from "@grafito/board";
import type { Board, Finding } from "@grafito/board";
import { ARCHITECT_DEFAULT_MODEL, isModelId } from "@grafito/contract";
import type { ArchitectRecord, Op, SketchPayload } from "@grafito/contract";
import { createArchitectSession, pickProposal } from "../session";
import type { ArchitectSessionState } from "../session";
import { loadCatalogs } from "../../live/catalogs";
import { fetchAvailableModels, totalCost, usableModel } from "../../live/models";
import type { ModelControl } from "../../live/models";
import { isLang, setLang, t as translate, useLang, useT } from "../../i18n";
import { browserStore } from "../../storage";
import { ProposalToolbar } from "./ProposalToolbar";
import { SpeechBubbles } from "./SpeechBubbles";
import { TimelineRail } from "./TimelineRail";
import { ReviewPanel } from "./ReviewPanel";
import { FindingPins } from "./FindingPins";
import { findingKeys, listedFindings, targetLabel } from "../review";
import { bubbleMarkers, initialBubbleView, openBubbles, toggleMarker, toggleRail, withCurrent } from "../bubbles";

/** What the panel needs from the drawn board: clicks on it, the selection outline, and where an item is on screen. */
export interface BoardCanvas {
  /** Called with the pencil item a click lands on, or null (ink, paper); null unsets it. */
  onPick(fn: ((key: string | null) => void) | null): void;
  select(keys: readonly string[]): void;
  screenRect(key: string): DOMRect | null;
}

/** What the toolbar's export, import and clear buttons do in architect mode. There is no undo. */
export interface ArchitectRecordControl {
  snapshot(): ArchitectRecord;
  restore(rec: ArchitectRecord): void;
  /** Starts over on a blank board and forgets the autosaved session. */
  reset(): void;
  /** Hands a sketch drawn on the board to the architect as a turn; true when Claude drew something from it. */
  sendSketch(sketch: SketchPayload): Promise<boolean>;
  /** At least one turn to export. */
  canExport: boolean;
  savedAt: number | null;
}

interface Props {
  board: { get(): Board; submit(ops: Op[]): Promise<void>; clear(): void };
  canvas: BoardCanvas;
  /** The sketch on the board: the strokes the architect drew something from are removed. */
  sketch?: { remove(ids: readonly string[]): void };
  /** The model choice for the options popover, while this panel is mounted. */
  onModelControl(c: ModelControl | null): void;
  /** The session controls for the toolbar, while this panel is mounted. */
  onRecordControl(c: ArchitectRecordControl | null): void;
  /** A record to reopen on mount (an import that switched the app to architect mode) instead of a blank board. */
  initialRecord?: ArchitectRecord | null;
}

/**
 * Architect mode's controls: the speech bubbles, the timeline rail of bubble markers, the one text box and the
 * restore banner. Mounting it starts a session on a blank board, or reopens `initialRecord`; unmounting saves it.
 */
export function ArchitectPanel({ board, canvas, sketch, onModelControl, onRecordControl, initialRecord }: Props) {
  const t = useT();
  const lang = useLang();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [model, setModel] = useState(ARCHITECT_DEFAULT_MODEL);
  const deps = useRef({ board, canvas, sketch, model, lang, available, busy: false });
  const session = useMemo(
    () => createArchitectSession({
      board: { get: () => deps.current.board.get(), submit: (ops) => deps.current.board.submit(ops), clear: () => deps.current.board.clear() },
      // The icon catalogs are the live panel's setting, saved on every change.
      settings: {
        get: () => ({ model: deps.current.model, catalogs: loadCatalogs(), lang: deps.current.lang }),
        apply: (s) => {
          if (isModelId(s.model)) setModel(usableModel(s.model, deps.current.available, ARCHITECT_DEFAULT_MODEL));
          if (isLang(s.lang)) setLang(s.lang);
        },
      },
      zoneTitle: () => translate("architect.zoneTitle"),
      dataTitle: () => translate("architect.dataTitle"),
      sketch: { remove: (ids) => deps.current.sketch?.remove(ids) },
      storage: browserStore,
    }),
    [],
  );
  const [state, setState] = useState<ArchitectSessionState>({ turns: [], busy: false, bubble: null, error: "", clicks: [], review: emptyReview(), unclosed: null, savedAt: null, warning: "" });
  deps.current = { board, canvas, sketch, model, lang, available, busy: state.busy };
  const seed = useRef(initialRecord);
  useEffect(() => {
    const off = session.subscribe(setState);
    if (seed.current) session.restore(seed.current);
    else session.start();
    return () => { off(); session.close(); };
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

  // Bubbles: one marker per turn from its say ops; the latest turn's bubble open, past ones open only on request.
  const markers = useMemo(() => bubbleMarkers(state.turns), [state.turns]);
  const current = state.turns.at(-1)?.n ?? 0;
  const [rawView, setView] = useState(initialBubbleView);
  const view = withCurrent(rawView, current);
  const shown = openBubbles(markers, view);
  const waiting = state.busy && !shown.some((m) => m.turn === current);

  const [typed, setTyped] = useState("");
  const send = () => { if (session.send(typed)) setTyped(""); };
  const input = useRef<HTMLInputElement>(null);

  // The selected proposal, and the item clicked to select it (the toolbar sits by that one).
  const [sel, setSel] = useState<{ proposal: string; key: string } | null>(null);
  useEffect(() => {
    const c = deps.current.canvas;
    c.onPick((key) => {
      const pick = pickProposal(deps.current.board.get(), key);
      // While a turn is in flight an alternative is not chosen: it is selected, and the toolbar says to wait.
      const choose = pick.do === "choose" && !deps.current.busy;
      if (choose) session.decide("accept", pick.proposal);
      setSel(pick.do !== "none" && !choose && key ? { proposal: pick.proposal, key } : null);
      if (pick.do !== "none") setFocus(null);
    });
    return () => { c.onPick(null); c.select([]); };
  }, [session]);
  // The review: its panel opens by itself when the first review arrives; a finding clicked there (or its pin) is
  // pointed at on the board with the same outline a selected proposal gets. One or the other, never both.
  const review = state.review;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const hasReview = !reviewIsEmpty(review);
  useEffect(() => { if (hasReview) setReviewOpen(true); }, [hasReview]);
  const focused = focus ? review.findings.find((f) => f.id === focus && f.open) : undefined;
  useEffect(() => {
    const b = deps.current.board.get();
    deps.current.canvas.select(sel ? proposalItems(b, sel.proposal) : focused ? findingKeys(b, focused) : []);
  }, [sel, focused]);
  useEffect(() => {
    if (!sel && !focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setSel(null); setFocus(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, focus]);
  const selectFinding = (id: string | null) => { setSel(null); setFocus(id); if (id) setReviewOpen(true); };
  const fix = (f: Finding) => { if (session.send(t("architect.review.fixPrompt", { id: f.id, text: f.text }))) setFocus(null); };
  const restore = useCallback((rec: ArchitectRecord) => { setSel(null); setFocus(null); session.restore(rec); }, [session]);
  const reset = useCallback(() => { setSel(null); setFocus(null); setReviewOpen(false); session.reset(); }, [session]);
  const canExport = state.turns.length > 0;
  useEffect(() => {
    onRecordControl({ snapshot: session.snapshot, restore, reset, sendSketch: (s) => session.sendSketch(s), canExport, savedAt: state.savedAt });
  }, [session, restore, reset, canExport, state.savedAt, onRecordControl]);
  useEffect(() => () => onRecordControl(null), [onRecordControl]);

  const decide = (type: "accept" | "reject") => {
    if (sel) session.decide(type, sel.proposal);
    setSel(null);
    input.current?.focus();
  };

  const unclosedModels = state.unclosed?.timeline.flatMap((e) => (e.kind === "turn" ? [e.model] : [])) ?? [];

  return (
    <div className="architect" data-testid="architect-panel">
      <SpeechBubbles
        bubbles={shown}
        current={current}
        waiting={waiting}
        board={() => deps.current.board.get()}
        screenRect={(key) => deps.current.canvas.screenRect(key)}
      />
      {sel && (
        <ProposalToolbar
          proposal={sel.proposal}
          anchor={() => (findProposal(deps.current.board.get(), sel.proposal) ? deps.current.canvas.screenRect(sel.key) : null)}
          onDecide={decide}
          busy={state.busy}
          onGone={() => setSel(null)}
        />
      )}
      <ReviewPanel
        review={review}
        open={reviewOpen}
        onOpen={(v) => { setReviewOpen(v); if (!v) setFocus(null); }}
        busy={state.busy}
        canRun={state.turns.length > 0}
        targetLabel={(target) => targetLabel(deps.current.board.get(), target)}
        selected={focused?.id ?? null}
        onSelect={selectFinding}
        onRun={() => session.send(t("architect.review.runPrompt"))}
        onFix={fix}
      />
      {reviewOpen && (
        <FindingPins
          findings={listedFindings(review)}
          keysOf={(f) => findingKeys(deps.current.board.get(), f)}
          screenRect={(key) => deps.current.canvas.screenRect(key)}
          selected={focused?.id ?? null}
          onSelect={selectFinding}
        />
      )}
      <div className="toasts">
        {state.unclosed && (
          <div className="toast" data-testid="architect-restore-banner">
            {t("restore.architect", { count: unclosedModels.length, cost: totalCost(unclosedModels, state.unclosed.totals.costUsd, t("cost.included")) })}
            <button className="pbtn" onClick={() => state.unclosed && restore(state.unclosed)}>{t("restore.restore")}</button>
            <button className="pbtn" onClick={reset}>{t("restore.discard")}</button>
          </div>
        )}
        {state.error && <div className="toast warn" data-testid="architect-error" role="alert">{state.error}</div>}
        {state.warning && <div className="toast warn" data-testid="architect-save-warn" role="alert">{state.warning}</div>}
      </div>
      <TimelineRail
        markers={markers}
        view={view}
        onMarker={(turn) => setView((v) => toggleMarker(withCurrent(v, current), turn))}
        onRail={() => setView((v) => toggleRail(withCurrent(v, current)))}
      />
      <form className="typebar" data-testid="architect-typebar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={input} data-testid="architect-input" aria-label={t("architect.input.label")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("architect.input.placeholder")} />
        <button className="pbtn primary" type="submit" disabled={!typed.trim() || state.busy}>{t("typebar.send")}</button>
      </form>
    </div>
  );
}
