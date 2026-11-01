// The architect session: one run of architect mode on a board that starts blank with the app-made system zone.
import { architectZoneOp } from "@grafito/board";
import type { Op } from "@grafito/contract";

export interface ArchitectSessionDeps {
  board: { submit(ops: Op[]): Promise<void>; clear(): void };
  /** Title of the system zone, in the app's language. */
  zoneTitle(): string;
}

export interface ArchitectSession {
  /** Wipes the board and makes the one system zone. */
  start(): void;
}

export function createArchitectSession(d: ArchitectSessionDeps): ArchitectSession {
  return {
    start() {
      d.board.clear();
      void d.board.submit([architectZoneOp(d.zoneTitle())]);
    },
  };
}
