// Browser preferences and the autosaved session live in localStorage, which can be missing or throw
// (private mode, quota, disabled storage). Every read and write goes through this wrapper, which never throws.
export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createStore(backing: () => Backing | null | undefined): Store {
  return {
    get(key) { try { return backing()?.getItem(key) ?? null; } catch { return null; } },
    set(key, value) { try { backing()?.setItem(key, value); } catch { /* storage unavailable */ } },
    remove(key) { try { backing()?.removeItem(key); } catch { /* storage unavailable */ } },
  };
}

/** In-memory adapter, for tests. */
export function memoryStore(init: Record<string, string> = {}): Store {
  const m = new Map(Object.entries(init));
  return createStore(() => ({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }));
}

export const browserStore: Store = createStore(() => (typeof localStorage === "undefined" ? null : localStorage));

/** A boolean preference stored as "1" / "0". */
export const readFlag = (key: string, fallback: boolean, s: Store = browserStore) => {
  const v = s.get(key);
  return v === null ? fallback : v !== "0";
};
export const writeFlag = (key: string, value: boolean, s: Store = browserStore) => s.set(key, value ? "1" : "0");
