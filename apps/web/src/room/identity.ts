// Who this browser is in a room: an id that survives reloads (so a reconnect is the same person) and the name
// the others see. Both live in storage.
import { browserStore } from "../storage";
import type { Store } from "../storage";

export interface Identity {
  id: string;
  /** "" until the person has picked one. */
  name: string;
}

const ID_KEY = "grafito.participant.id";
const NAME_KEY = "grafito.participant.name";
export const NAME_MAX = 40;

const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * Trimmed and cut to what the room accepts; "" if nothing is left. The same rule the server applies
 * (`cleanRoomName`): no control characters or square brackets, and nobody is called Claude.
 */
export const cleanName = (name: string) => {
  const n = name.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}[\]]/gu, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === "claude" ? "" : n;
};

export function loadIdentity(store: Store = browserStore): Identity {
  let id = store.get(ID_KEY) ?? "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || id === "claude") {
    id = newId();
    store.set(ID_KEY, id);
  }
  return { id, name: cleanName(store.get(NAME_KEY) ?? "") };
}

export function saveName(name: string, store: Store = browserStore): string {
  const n = cleanName(name);
  if (n) store.set(NAME_KEY, n);
  return n;
}

/** Up to two letters for an avatar: the first letter of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? "?")].slice(0, 2).join("");
  return letters.toUpperCase();
}
