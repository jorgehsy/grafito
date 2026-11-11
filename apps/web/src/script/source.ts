// What demo mode can play: a built-in demo, or a saved session opened as a replay.
import { parseRecord } from "@grafito/contract";
import { recordToDemo } from "@grafito/board";
import type { Demo } from "@grafito/board";
import { DEMOS } from "../demos";
import { t } from "../i18n";

export interface ScriptSource {
  id: string;
  name: string;
  /** One line under the name. */
  description: string;
  demo: Demo;
  /** Its ops are architect ops: applied with `applyArchitectOp`. */
  architect: boolean;
  /** A saved session, not a built-in demo. */
  replay: boolean;
  /** Language the demo is spoken in (built-in demos only). */
  lang?: string;
  /** Something the user should know about this source (ops that were skipped); "" if nothing. */
  note: string;
}

export const BUILT_IN: ScriptSource[] = DEMOS.map((d) => ({ id: d.id, name: d.name, description: d.description, demo: d.demo, architect: false, replay: false, lang: d.lang, note: "" }));

export type LoadedSource = { ok: true; source: ScriptSource } | { ok: false; error: string };

/** A session record's JSON text as something to play. `error` is already in the user's language. */
export function sourceFromRecordText(text: string): LoadedSource {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, error: t("import.notRecord") }; }
  const p = parseRecord(json);
  if (!p.ok) return { ok: false, error: p.outdated ? t("record.outdated") : t("import.notRecord") };
  const rec = p.record;
  const architect = rec.appMode === "architect";
  const replay = recordToDemo(rec, {
    zoneTitle: t("architect.zoneTitle"),
    dataTitle: t("architect.dataTitle"),
    clickText: (type) => t(type === "accept" ? "script.click.accept" : "script.click.reject"),
  });
  if (!replay.demo.length) return { ok: false, error: t("script.session.empty") };
  const date = new Date(rec.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return {
    ok: true,
    source: {
      id: `session:${rec.id}`,
      name: t(architect ? "script.session.architectName" : "script.session.name", { date }),
      description: rec.summary.trim() || t("script.session.steps", { count: replay.demo.length }),
      demo: replay.demo,
      architect,
      replay: true,
      note: replay.dropped ? t("script.session.dropped", { count: replay.dropped }) : "",
    },
  };
}
