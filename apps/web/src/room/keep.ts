// What a browser tab keeps about the rooms it is in, in sessionStorage: it lasts across a reload and goes with
// the tab. Two secrets per room: the invite token (so it need not stay in the address bar or the history) and
// the resume secret the server gave this tab (so a reload is the same participant).
import { ROOM_TOKEN_PATTERN } from "@grafito/contract";
import { createStore } from "../storage";
import type { Store } from "../storage";

export const tabStore: Store = createStore(() => (typeof sessionStorage === "undefined" ? null : sessionStorage));

const key = (roomId: string, what: "key" | "resume") => `grafito.room.${roomId}.${what}`;
const secret = (v: string | null) => (v && ROOM_TOKEN_PATTERN.test(v) ? v : "");

export const loadRoomKey = (roomId: string, store: Store = tabStore) => secret(store.get(key(roomId, "key")));
export const saveRoomKey = (roomId: string, token: string, store: Store = tabStore) => store.set(key(roomId, "key"), token);
export const loadResume = (roomId: string, store: Store = tabStore) => secret(store.get(key(roomId, "resume")));
export const saveResume = (roomId: string, resume: string, store: Store = tabStore) => store.set(key(roomId, "resume"), resume);
