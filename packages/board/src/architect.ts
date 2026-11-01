// Architect mode starts every board the same way: one system zone made by the app, never by Claude.
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";

/** Id of the one system zone of an architect board; Claude's `add_component` names it as its zone. */
export const ARCHITECT_ZONE_ID = "system";

/** The op that makes the system zone when architect mode starts. `title` is in the app's language. */
export const architectZoneOp = (title: string): Op => op.create_zone({ id: ARCHITECT_ZONE_ID, kind: "system", title });
