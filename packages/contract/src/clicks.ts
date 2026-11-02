// What the user decided by clicking proposals in architect mode, sent with the next turn (the request field `actions`).
import { z } from "zod";

/** At most this many clicks ride along with one turn; more is a malformed request. */
export const MAX_CLICKS = 200;

/**
 * One click on a proposal: ✓ (or choosing an alternative) is an accept, ✗ a reject. It was already applied in the
 * browser; Claude sees it so it does not ask again.
 */
export const ProposalClickSchema = z.strictObject({
  type: z.enum(["accept", "reject"]),
  proposal: z.string().min(1).refine((v) => v.trim().length > 0, "must not be blank"),
});
export type ProposalClick = z.output<typeof ProposalClickSchema>;

const ClicksSchema = z.array(ProposalClickSchema).max(MAX_CLICKS);

/** `actions` from a request body: absent is none. Null when malformed. */
export function parseClicks(raw: unknown): ProposalClick[] | null {
  if (raw === undefined) return [];
  const r = ClicksSchema.safeParse(raw);
  return r.success ? r.data : null;
}
