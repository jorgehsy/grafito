// Replay: a saved session record turned into a demo, so it plays back like one. Each request (live) or turn
// (architect) is a chunk and a chapter: its text is the subtitle and its ops land in order. The pace is the
// demo's own (speaking time plus simulated latency), not the session's real clock. No DOM.
import { parseOp } from "@grafito/contract";
import type { ArchitectRecord, LiveRecord, Op, RecordClick, SessionRecord } from "@grafito/contract";
import { CATALOG_IDS } from "@grafito/icons";
import { architectDataZoneOp, architectZoneOp, clickOp, needsDataZone } from "./architect";
import { isReviewOp } from "./review";
import { shortTitle, timeline } from "./demo-timeline";
import type { Demo, DemoChunk } from "./demo-timeline";

export interface Replay {
  demo: Demo;
  /** Which apply step its ops need: `applyOp`, or `applyArchitectOp` for an architect record. */
  opSet: "board" | "architect";
  /** Recorded ops that no longer parse and were left out. */
  dropped: number;
}

export interface ReplayOptions {
  /** Title of the system zone an architect board starts with. */
  zoneTitle?: string;
  /** Title of the data zone the app adds before the first entity (architect records). */
  dataTitle?: string;
  /** The subtitle for a click on a proposal (architect records). */
  clickText?(type: RecordClick["type"]): string;
}

type Step = Omit<DemoChunk, "at_ms">;

/** The record does not say which catalogs were on, so its ops are parsed with all of them. */
function liveSteps(rec: LiveRecord): { steps: Step[]; dropped: number } {
  const steps: Step[] = [];
  let dropped = 0;
  for (const r of rec.requests) {
    // An undone instruction is not on the final board: the replay shows the session as it was kept.
    if (r.undone) continue;
    const ops: Op[] = [];
    for (const raw of r.ops) {
      const p = parseOp(raw, CATALOG_IDS);
      if (p.ok) ops.push(p.op); else dropped++;
    }
    const text = r.batch.trim();
    if (!text && !ops.length) continue;
    steps.push({ title: shortTitle(text || "…"), text: text || "…", ops });
  }
  return { steps, dropped };
}

function architectSteps(rec: ArchitectRecord, o: ReplayOptions): { steps: Step[]; dropped: number } {
  const steps: Step[] = [];
  let dropped = 0;
  let clicks: Step | null = null;
  let dataZone = false;
  const clickText = o.clickText ?? ((type) => type);
  for (const e of rec.timeline) {
    if (e.kind === "click") {
      // Clicks in a row are one step: they need no words between them.
      if (!clicks) { clicks = { text: "", ops: [] }; steps.push(clicks); }
      clicks.text = clicks.text ? `${clicks.text}, ${clickText(e.type)}` : clickText(e.type);
      clicks.ops.push(clickOp(e));
      continue;
    }
    clicks = null;
    const ops: Op[] = [];
    for (const raw of e.ops) {
      const p = parseOp(raw, CATALOG_IDS, "architect");
      if (!p.ok) dropped++;
      // say is the turn's bubble and review ops are the review: neither is drawn. The data zone is the app's,
      // made just before the first entity, as in the session.
      else if (p.op.name !== "say" && !isReviewOp(p.op)) {
        if (needsDataZone(p.op) && !dataZone) { dataZone = true; ops.push(architectDataZoneOp(o.dataTitle ?? "Data model")); }
        ops.push(p.op);
      }
    }
    const text = e.text.trim() || "…";
    steps.push({ title: shortTitle(text), text, ops });
  }
  // The system zone is the app's, made before the first turn.
  if (steps.length) steps[0].ops = [architectZoneOp(o.zoneTitle ?? "System"), ...steps[0].ops];
  return { steps, dropped };
}

/** A session record as a demo. An empty record gives an empty demo. */
export function recordToDemo(rec: SessionRecord, options: ReplayOptions = {}): Replay {
  const { steps, dropped } = rec.appMode === "architect" ? architectSteps(rec, options) : liveSteps(rec);
  return { demo: timeline(steps), opSet: rec.appMode === "architect" ? "architect" : "board", dropped };
}
