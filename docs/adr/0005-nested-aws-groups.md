# AWS groups nest as a tree inside the system zone

Status: accepted (decided in #38, part of #31)

Architect mode draws AWS architectures, and AWS draws them as boxes inside boxes: AWS Cloud > Region > VPC > Availability Zone > subnet > services. Until now the board had no nesting: zones are flat, each element belongs to one zone, and each zone is one flat ELK run.

We decided:

- **Groups are a tree inside a system zone.** A group has a kind (AWS Cloud, Region, VPC, Availability Zone, public subnet, private subnet, generic), a label and at most one parent group. A component has at most one parent group. No new zone kind.
- **The system zone layout becomes a compound ELK layout** (`hierarchyHandling: INCLUDE_CHILDREN`), so a group's box comes from its children and arrows can cross group borders.
- **Groups that cross other groups wait.** Security groups and Auto Scaling groups are labels on a component in v1, not boxes, so "one parent" holds. Something in two AZs is drawn as two components.
- **Deleting a group lifts its children** to its parent; nothing disappears unless it is named. Rejecting a proposal still erases what was proposed.
- **Arrows join components only**, never a group. Empty groups are allowed and get a minimum size.
- **Groups are drawn only when they mean something** (private network, more than one AZ); a serverless design stays flat.
- Look: AWS's border colour and line style per kind, plus its corner icon, in the hand-drawn style; groups can be in pencil like any proposal.

Considered: one zone per AWS box, by prompt convention only (no real nesting, does not look like AWS); one flat group level (cannot put a VPC around AZs, the most common AWS picture). Findings: `docs/research/aws-containers.md` on branch `research/aws-containers`.

## Consequences

- The board model, ops, layout result, renderer and saved-session record all change; the record version and the prompt hash need a bump.
- The flat-result code in `packages/board/src/layout/elk.ts` (labels, emphasis circle) must learn nested results.
- ELK's behaviour with the current options (`NETWORK_SIMPLEX`, `separateConnectedComponents`) inside compound nodes is untested.
