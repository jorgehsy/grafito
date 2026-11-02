// What the user decided by clicking in architect mode, sent with the next turn as `actions`.
import { z } from "zod";

/** At most this many clicks ride along with one turn; more is a malformed request. */
export const MAX_ACTIONS = 200;

/**
 * One click on a proposal: ✓ (or choosing an alternative) is an accept, ✗ a reject. It was already applied in the
 * browser; Claude sees it so it does not ask again.
 */
export const ArchitectActionSchema = z.strictObject({
  type: z.enum(["accept", "reject"]),
  proposal: z.string().min(1).refine((v) => v.trim().length > 0, "must not be blank"),
});
export type ArchitectAction = z.output<typeof ArchitectActionSchema>;

const ActionsSchema = z.array(ArchitectActionSchema).max(MAX_ACTIONS);

/** `actions` from a request body: absent is none. Null when malformed. */
export function parseActions(raw: unknown): ArchitectAction[] | null {
  if (raw === undefined) return [];
  const r = ActionsSchema.safeParse(raw);
  return r.success ? r.data : null;
}
