// The rooms the server knows: in memory while it runs, and one JSON file each under rooms/ so a restart
// does not lose a board people are still working on.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ROOM_ID_PATTERN, ROOM_TOKEN_PATTERN, roomEventSchema } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { Room } from "./room";
import type { SavedRoom } from "./room";
import type { Clients } from "../routes/turn";
import { DEFAULT_LIMITS } from "./limits";
import type { RoomLimits } from "./limits";

export const DEFAULT_ROOMS_DIR = resolve(fileURLToPath(new URL("../..", import.meta.url)), "rooms");

const savedSchema = z.object({
  id: z.string().regex(ROOM_ID_PATTERN), createdAt: z.number(), events: z.array(roomEventSchema),
  token: z.string().regex(ROOM_TOKEN_PATTERN).optional(), calls: z.number().optional(), spentUsd: z.number().optional(), lastActiveAt: z.number().optional(),
});

// No look-alikes (0/o, 1/l), so an id read aloud or copied by hand still works.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const newRoomId = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** The server already holds `GRAFITO_MAX_ROOMS` rooms and none of them can be dropped. */
export class RoomsFull extends Error {
  constructor(max: number) {
    super(`The server already holds ${max} rooms; close one or raise GRAFITO_MAX_ROOMS`);
    this.name = "RoomsFull";
  }
}

export interface RegistryOptions {
  clients: Clients;
  /** Where rooms are saved; null keeps them in memory only. */
  dir?: string | null;
  /** How long after the last event a room is written. */
  saveDelayMs?: number;
  now?: () => number;
  /** What rooms may use, and how many there may be (default: `DEFAULT_LIMITS`). */
  limits?: RoomLimits;
}

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private loading = new Map<string, Promise<Room | undefined>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = new Map<string, Promise<void>>();
  private readonly dir: string | null;
  private readonly delay: number;
  private readonly limits: RoomLimits;

  constructor(private opts: RegistryOptions) {
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.dir = opts.dir === undefined ? DEFAULT_ROOMS_DIR : opts.dir;
    this.delay = opts.saveDelayMs ?? 1500;
  }

  private deps() {
    return { clients: this.opts.clients, now: this.opts.now, limits: this.limits, onChange: (room: Room) => this.schedule(room) };
  }

  /** Nobody in it and nothing happening for longer than rooms are kept: its link no longer opens it. */
  private expired(room: Room): boolean {
    return this.limits.idleMs > 0 && room.empty() && room.idleFor() > this.limits.idleMs;
  }

  /** Takes a room out of memory, writing it first if a save was pending. Its file stays. */
  private drop(room: Room) {
    const timer = this.timers.get(room.id);
    if (timer) { clearTimeout(timer); this.timers.delete(room.id); void this.save(room); }
    this.rooms.delete(room.id);
  }

  /**
   * Whether one more room fits in memory. Expired rooms go first; then, if rooms are saved to disk (so nothing
   * is lost), the empty room that has been idle longest. A room with someone in it is never dropped.
   */
  private makeSpace(): boolean {
    for (const room of [...this.rooms.values()]) if (this.expired(room)) this.drop(room);
    if (this.rooms.size < this.limits.maxRooms) return true;
    if (!this.dir) return false;
    const idle = [...this.rooms.values()].filter((r) => r.empty()).sort((a, b) => b.idleFor() - a.idleFor())[0];
    if (!idle) return false;
    this.drop(idle);
    return true;
  }

  /** How many rooms are in memory. */
  get size(): number {
    return this.rooms.size;
  }

  /** A new room, optionally starting from a board (its ops). Throws `RoomsFull` when the server holds all the rooms it takes. */
  create(seed: readonly Op[] = []): Room {
    if (!this.makeSpace()) throw new RoomsFull(this.limits.maxRooms);
    let id = newRoomId();
    while (this.rooms.has(id)) id = newRoomId();
    const room = new Room(id, this.deps());
    this.rooms.set(id, room);
    room.seed(seed);
    this.schedule(room);
    return room;
  }

  /** The room with this id: from memory, else from disk; undefined if there is none. */
  async get(id: string): Promise<Room | undefined> {
    if (!ROOM_ID_PATTERN.test(id)) return undefined;
    const known = this.rooms.get(id);
    if (known && this.expired(known)) { this.drop(known); return undefined; }
    if (known || !this.dir) return known;
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(id).finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  private async load(id: string): Promise<Room | undefined> {
    let saved: SavedRoom;
    try {
      const r = savedSchema.safeParse(JSON.parse(await readFile(this.file(id), "utf8")));
      if (!r.success || r.data.id !== id) return undefined;
      saved = r.data;
    } catch { return undefined; }
    const known = this.rooms.get(id);
    if (known) return known;
    const room = new Room(id, this.deps(), saved);
    if (this.expired(room) || !this.makeSpace()) return undefined;
    this.rooms.set(id, room);
    // a room saved without a token was just given one: keep it
    if (!saved.token) this.schedule(room);
    return room;
  }

  private file(id: string) {
    return resolve(this.dir!, `${id}.json`);
  }

  private schedule(room: Room) {
    if (!this.dir || this.timers.has(room.id)) return;
    this.timers.set(room.id, setTimeout(() => { this.timers.delete(room.id); void this.save(room); }, this.delay));
  }

  private save(room: Room): Promise<void> {
    // one write per room at a time, each with the room as it is when its turn comes
    const next = (this.writes.get(room.id) ?? Promise.resolve()).then(async () => {
      try {
        // A room's file holds its invite token: only this user reads the folder and the file. `mode` only
        // applies to what is created, so what was already there is tightened too.
        await mkdir(this.dir!, { recursive: true, mode: 0o700 });
        await chmod(this.dir!, 0o700);
        await writeFile(this.file(room.id), JSON.stringify(room.snapshot()), { mode: 0o600 });
        await chmod(this.file(room.id), 0o600);
      } catch (e: any) {
        console.error(`[grafito] could not save room ${room.id}: ${e?.message ?? e}`);
      }
    });
    this.writes.set(room.id, next);
    return next;
  }

  /** Writes every room with a save pending, now. */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    for (const id of pending) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
    await Promise.all(pending.map((id) => this.save(this.rooms.get(id)!)));
    await Promise.all(this.writes.values());
  }
}
