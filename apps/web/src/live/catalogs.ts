// Enabled icon catalogs: a browser preference shared by all sessions; restoring or importing a session does not change it.
export const CATALOGS_KEY = "grafito.catalogs";
export const CATALOG_IDS = ["aws"] as const;

type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => { try { return localStorage; } catch { return null; } };

/** Reads the enabled catalogs; none if storage is missing or the data is malformed. */
export function loadCatalogs(s: Store | null = store()): string[] {
  try {
    const v = JSON.parse(s?.getItem(CATALOGS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && (CATALOG_IDS as readonly string[]).includes(x)) : [];
  } catch { return []; }
}

export function saveCatalogs(ids: string[], s: Store | null = store()): void {
  try { s?.setItem(CATALOGS_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}
