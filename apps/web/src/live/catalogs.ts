// Enabled icon catalogs: a browser preference shared by all sessions; restoring or importing a session does not change it.
import { isCatalogId } from "@grafito/icons";
import { browserStore } from "../storage";
import type { Store } from "../storage";

export const CATALOGS_KEY = "grafito.catalogs";

/** Reads the enabled catalogs; none if nothing is stored or the data is malformed. */
export function loadCatalogs(s: Store = browserStore): string[] {
  try {
    const v = JSON.parse(s.get(CATALOGS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => isCatalogId(x)) : [];
  } catch { return []; }
}

export function saveCatalogs(ids: string[], s: Store = browserStore): void {
  s.set(CATALOGS_KEY, JSON.stringify(ids));
}
