// Opening and finding rooms: a room is made on the server from the board on screen, and lives at
// `?room=<id>#k=<invite token>`. The token is in the fragment because a browser never sends the fragment to a
// server: it stays out of access logs, proxies and the Referer header (ADR 0009).
import { ROOM_ID_PATTERN, ROOM_TOKEN_PATTERN } from "@grafito/contract";
import type { LiveRecord } from "@grafito/contract";
import { loadRoomKey, saveRoomKey } from "./keep";
import type { Store } from "../storage";

type RawOp = { name: string; input: unknown };

/** A room and what it takes to join it. */
export interface RoomRef { id: string; token: string }

/** The ops that rebuild a live session's board: every request's, minus the undone ones. */
export const seedOps = (rec: LiveRecord): RawOp[] => rec.requests.filter((r) => !r.undone).flatMap((r) => r.ops);

/** Makes a room that starts from `ops` (none = an empty board) and returns its id and invite token. */
export async function startRoom(ops: readonly RawOp[] = [], fetchImpl: typeof fetch = fetch): Promise<RoomRef> {
  const res = await fetchImpl("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) });
  if (!res.ok) {
    // the server says why in words (only the owner may open rooms, too many rooms)
    const said = await res.json().then((b: { error?: unknown }) => (typeof b?.error === "string" ? b.error : ""), () => "");
    throw new Error(said || `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id?: unknown; token?: unknown };
  if (typeof body?.id !== "string" || !ROOM_ID_PATTERN.test(body.id)) throw new Error("bad room id");
  if (typeof body.token !== "string" || !ROOM_TOKEN_PATTERN.test(body.token)) throw new Error("bad room token");
  return { id: body.id, token: body.token };
}

const here = () => (typeof location === "undefined" ? "http://localhost/" : location.href);

/** The room this page is in, from `?room=`; null if there is none or it is not a room id. */
export function roomIdFromUrl(href: string = here()): string | null {
  const id = new URL(href).searchParams.get("room");
  return id && ROOM_ID_PATTERN.test(id) ? id : null;
}

/** The invite token this page was opened with, from `#k=`; "" if there is none or it is not a token. */
export function roomKeyFromUrl(href: string = here()): string {
  const k = new URLSearchParams(new URL(href).hash.slice(1)).get("k");
  return k && ROOM_TOKEN_PATTERN.test(k) ? k : "";
}

/** What `takeRoomKey` needs from the page; tests pass their own. */
export interface KeyPage {
  href?: string;
  store?: Store;
  /** Replaces the address shown, without loading anything (default: `history.replaceState`). */
  replace?(url: string): void;
}

/**
 * The invite token of the room this page is in, taken off the address. A link arrives as `?room=<id>#k=<token>`;
 * the token is moved to this tab's storage and the fragment is removed from the address bar, so it is not left
 * in the history, a screenshot or a shared screen. After a reload the address has no token and the stored one
 * is used. "" if this tab never had one for this room.
 */
export function takeRoomKey(roomId: string, page: KeyPage = {}): string {
  const href = page.href ?? here();
  const fromUrl = roomKeyFromUrl(href);
  if (!fromUrl) return loadRoomKey(roomId, page.store);
  saveRoomKey(roomId, fromUrl, page.store);
  const u = new URL(href);
  u.hash = "";
  const replace = page.replace ?? ((url: string) => { if (typeof history !== "undefined") history.replaceState(history.state, "", url); });
  try { replace(u.toString()); } catch { /* the address keeps its fragment; the room still works */ }
  return fromUrl;
}

/**
 * The link that opens a room: `?room=<id>#k=<token>` and nothing else (a room is always live mode), on this
 * page or on `base` (the public address, when the server is shared through a tunnel).
 */
export function roomUrl(room: RoomRef, base: string = here()): string {
  const u = new URL(base);
  u.search = "";
  u.searchParams.set("room", room.id);
  u.hash = room.token ? `k=${room.token}` : "";
  return u.toString();
}

/** This page without the room or its token: where "Leave" goes. */
export function leaveRoomUrl(href: string = here(), mode?: string): string {
  const u = new URL(href);
  u.searchParams.delete("room");
  if (mode) u.searchParams.set("mode", mode);
  u.hash = "";
  return u.toString();
}

/** What `GET /api/share` says: whether the server is shared through a tunnel, and its public address (owner only). */
export interface ShareInfo { share: boolean; owner: boolean; publicUrl: string | null }

/** Asks the server; null if it does not answer (an older server, or none). Never throws. */
export async function shareInfo(fetchImpl: typeof fetch = fetch): Promise<ShareInfo | null> {
  try {
    const res = await fetchImpl("/api/share");
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<ShareInfo>;
    let publicUrl: string | null = null;
    try { if (typeof b.publicUrl === "string" && /^https?:$/.test(new URL(b.publicUrl).protocol)) publicUrl = b.publicUrl; } catch { /* not a URL */ }
    return { share: b.share === true, owner: b.owner !== false, publicUrl };
  } catch { return null; }
}
