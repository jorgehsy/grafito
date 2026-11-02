// Operation vocabulary: single source of truth.
// One Zod schema per operation. The TS types are inferred from it, parseOp validates with it,
// and toolDefs exports it as JSON Schema shaped like an Anthropic tool ({name, description, input_schema}).
// No operation carries coordinates.
import { z } from "zod";

export const ZONE_KINDS = ["flow", "system", "list", "compare", "mindmap", "scale", "cycle", "timeline", "tree"] as const;
const MARK_TONES = ["neutral", "warn", "danger", "ok"] as const;
const TEXT_FIELDS = ["label", "note", "text", "when"] as const;
const COMP_TYPES = ["actor", "client", "service", "database", "queue", "storage", "external"] as const;
const EMPHASIS_STYLES = ["circle", "underline", "star"] as const;
/** AWS group kinds (architect mode): the boxes AWS diagrams nest, outermost first, plus a generic one. */
export const GROUP_KINDS = ["aws_cloud", "region", "vpc", "availability_zone", "public_subnet", "private_subnet", "generic"] as const;

export type ZoneKind = (typeof ZONE_KINDS)[number];
export type MarkTone = (typeof MARK_TONES)[number];
export type TextField = (typeof TEXT_FIELDS)[number];
export type ComponentType = (typeof COMP_TYPES)[number];
export type EmphasisStyle = (typeof EMPHASIS_STYLES)[number];
export type GroupKind = (typeof GROUP_KINDS)[number];

// Checks that do not show in the JSON Schema Claude sees (refinements are not exported):
// required text must not be blank, a span must go forward, an arrow needs two ends.
const notBlank = (v: string) => v.trim().length > 0;
const str = (description: string) => z.string().describe(description);
/** Required text: also rejects whitespace-only values. */
const text = (description: string) => z.string().refine(notBlank, "must not be blank").describe(description);
const id = (description: string) => z.string().min(1).refine(notBlank, "must not be blank").describe(description);
const pos = (description: string) => z.number().min(0).max(100).describe(description);

const CONNECT_SHAPE = {
  id: id("Unique identifier of the connection."),
  from: id("Id of the source element."),
  to: id("Id of the target element."),
  label: str("Short text over the arrow.").optional(),
  style: z.enum(["solid", "dashed"]).describe("dashed = optional, asynchronous or weak relation.").optional(),
  both_ways: z.boolean().describe("Arrow with a head at both ends.").optional(),
};
const twoEnds = (i: { from: string; to: string }) => i.from !== i.to;
const SAME_ENDS = { message: "source and target are the same", path: ["to"] };

/** Input schema per operation with every catalog off, in the order Claude sees the tools. */
const INPUTS = {
  create_zone: z.strictObject({
    id: id("Unique, stable identifier, e.g. 'order_process'."),
    kind: z.enum(ZONE_KINDS),
    title: text("Short title of the zone."),
    left_title: str("Compare only: title of the left column.").optional(),
    right_title: str("Compare only: title of the right column.").optional(),
    min_label: str("Scale only: label of the left end of the bar (default '0%').").optional(),
    max_label: str("Scale only: label of the right end of the bar (default '100%').").optional(),
    center_label: str("Cycle only: text in the center of the cycle, what cycles (e.g. 'Context window').").optional(),
    place: z
      .strictObject({ relation: z.enum(["right_of", "below"]), of: id("Id of the reference zone.") })
      .describe("Optional placement hint relative to another zone.")
      .optional(),
  }),
  add_step: z.strictObject({
    zone: id("Id of a flow zone."),
    id: id("Unique identifier."),
    label: text("Short text of the step (2 to 6 words)."),
    icon: str("Optional emoji.").optional(),
    after: id("Id of the previous element it follows (draws the arrow).").optional(),
  }),
  add_decision: z.strictObject({
    zone: id("Id of a flow zone."),
    id: id("Unique identifier."),
    question: text("Short question, e.g. 'In stock?'."),
    after: id("Id of the previous element.").optional(),
  }),
  add_component: z.strictObject({
    zone: id("Id of a system zone."),
    id: id("Unique identifier."),
    label: text("Short name."),
    type: z.enum(COMP_TYPES),
    icon: str("Optional emoji.").optional(),
  }),
  add_node: z.strictObject({
    zone: id("Id of a mindmap zone."),
    id: id("Unique identifier."),
    label: text("Short idea."),
    parent: id("Id of the parent node.").optional(),
  }),
  add_item: z.strictObject({
    zone: id("Id of a list or compare zone."),
    id: id("Unique identifier."),
    text: text("Text of the item."),
    column: z.enum(["left", "right"]).optional(),
  }),
  add_branch: z.strictObject({
    zone: id("Id of a tree zone."),
    id: id("Unique identifier."),
    label: text("Short name of the node (1 to 4 words)."),
    parent: id("Id of the parent node (optional; without it, a root).").optional(),
    note: str("Short explanation under the label (optional).").optional(),
  }),
  add_mark: z.strictObject({
    zone: id("Id of a scale zone."),
    id: id("Unique identifier."),
    at: pos("Position on the bar, from 0 to 100."),
    label: text("Short label of the mark, e.g. '20%: gets worse'."),
    note: str("Short explanation written underneath (optional).").optional(),
    tone: z
      .enum(MARK_TONES)
      .describe("neutral = ink; warn = amber (careful); danger = red (dangerous limit); ok = green.")
      .optional(),
  }),
  add_stage: z.strictObject({
    zone: id("Id of a cycle zone."),
    id: id("Unique identifier."),
    label: text("Short name of the stage (2 to 5 words)."),
    note: str("Short explanation underneath (optional).").optional(),
    after: id("Id of the stage to insert after (optional; default at the end).").optional(),
  }),
  add_event: z.strictObject({
    zone: id("Id of a timeline zone."),
    id: id("Unique identifier."),
    label: text("Short text of the event."),
    when: str("Date or short tag next to the tick: 'Before', '2024', 'Month 1' (optional).").optional(),
    note: str("Short explanation under the label (optional).").optional(),
    at: pos("Position on the axis, from 0 to 100 (optional).").optional(),
  }),
  add_span: z
    .strictObject({
      zone: id("Id of a timeline zone."),
      id: id("Unique identifier."),
      from: pos("Start of the span, from 0 to 100."),
      to: pos("End of the span, from 0 to 100 (greater than from)."),
      label: text("Short text of the span, e.g. '2 to 3 months'."),
      tone: z.enum(MARK_TONES).describe("neutral = ink; warn = amber (slow or costly); danger = red; ok = green (good).").optional(),
    })
    .refine((i) => i.from < i.to, { message: "from must be less than to", path: ["to"] }),
  set_level: z.strictObject({
    zone: id("Id of a scale zone."),
    at: pos("How far the fill reaches, from 0 to 100."),
    label: str("Short text over the fill (optional), e.g. 'filling up'.").optional(),
  }),
  connect: z.strictObject(CONNECT_SHAPE).refine(twoEnds, SAME_ENDS),
  emphasize: z.strictObject({ target: id("Id of the element or zone."), style: z.enum(EMPHASIS_STYLES) }),
  mark_question: z.strictObject({ target: id("Id of the element or zone."), text: str("The doubt in a few words (optional).").optional() }),
  add_callout: z.strictObject({ id: id("Unique identifier."), target: id("Id of the element or zone pointed at."), text: text("Very short text.") }),
  update_label: z.strictObject({ id: id("Id to change."), label: text("New text.") }),
  update_text: z.strictObject({
    id: id("Id of the element, zone, connection or callout."),
    field: z.enum(TEXT_FIELDS),
    value: str("New text; empty to remove it."),
  }),
  delete: z.strictObject({ id: id("Id to delete.") }),
  move_to_zone: z.strictObject({ id: id("Id of the element."), zone: id("Id of the target zone.") }),
  update_summary: z.strictObject({ text: text("Summary.") }),
};

/** Tool descriptions (prompt text). Key order = tool order. */
const DESCRIPTIONS: Record<keyof typeof INPUTS, string> = {
  create_zone:
    "Creates a zone (a topic box) on the board. Use it when the speaker starts a new topic. kind: flow = step-by-step process; system = architecture of components; list = list of items; compare = two columns compared; mindmap = branching ideas; scale = a quantity that changes along an axis (bar with thresholds: percentage, capacity, time, level); cycle = something that repeats in a loop; timeline = events or phases over time, before/now; tree = a hierarchy or classification that grows from left to right (categories with subcategories, types with their outcomes, breakdowns). No coordinates are given: the board places the zone. 'place' only to ask for a neighbor.",
  add_step: "Adds a step (rectangle) to a flow zone. 'after' connects it to the previous step automatically.",
  add_decision: "Adds a decision (diamond) to a flow zone. The branches are connected afterwards with connect and a label ('yes', 'no').",
  add_component:
    "Adds a component to a system zone. type: actor = person (stick figure); client = browser or phone; service = service box; database = cylinder; queue = queue or pipe; storage = bucket or folder; external = dotted cloud of a third party.",
  add_node: "Adds an idea to a mindmap zone. Without 'parent' it is the central idea (or hangs from it).",
  add_item: "Adds an item to a list or compare zone. In compare, 'column' picks the column.",
  add_branch:
    "Adds a node to a tree zone: a box in the hierarchy. Without 'parent' it is a root (several roots stack up); with 'parent' it hangs from that node, in a column to its right. Siblings stack in the order they are added and the board draws the connectors. Parents before children.",
  add_mark:
    "Adds a mark (threshold) to a scale zone: a notch on the bar with its label and, underneath, a short explanation. 'at' is the position on the bar, from 0 to 100. The board keeps labels from overlapping.",
  add_stage:
    "Adds a stage to a cycle zone. Stages are placed in a circle in the order they are added (or after 'after'), with clockwise arrows, and the last one returns to the first.",
  add_event:
    "Adds an event or phase to a timeline zone: a tick on the time axis with 'when' next to the tick and its label in a box above or below. Without 'at' events are spread evenly in the order they are added; with 'at' (0 to 100) they are placed proportionally.",
  add_span:
    "Adds to a timeline zone a span (brace under the axis) covering a duration, e.g. '2 to 3 months'. 'from' and 'to' are axis positions from 0 to 100, with from < to.",
  set_level: "Fills the bar of a scale zone up to 'at' (0 to 100): the current level, e.g. 'filling up'. Calling it again moves the level.",
  connect:
    "Draws an arrow between two elements, inside one zone or across zones (e.g. from a step of a flow to a component of an architecture).",
  emphasize: "Highlights an element or zone by hand: circle, underline or star. For what the speaker marks as important.",
  mark_question: "Marks an element with a hand-drawn question mark: a doubt, an unresolved point.",
  add_callout: "Adds a short handwritten note with a curved arrow pointing at the element.",
  update_label: "Changes the text of an element, zone, connection or callout (when the speaker corrects themselves).",
  update_text:
    "Changes or REMOVES a text inside an element without deleting the element. field: label = zone title, element label or connection label; note = note of a mark, stage, event or tree node; text = text of a handwritten note (callout); when = date of an event. An empty value removes the optional text (note, when, connection label). Use it instead of delete when only removing or changing a text is asked.",
  delete: "Deletes an element, connection, callout or zone. Deleting a zone deletes all its content; deleting an element removes its connections.",
  move_to_zone: "Moves an element to another zone (of a compatible kind).",
  update_summary: "Updates the one or two sentence summary of everything said so far.",
};

// ---- Architect mode ----
// Architect mode offers its own op set: some board ops, then ops of its own that the board set never shows.

/** Which tools Claude is offered: `board` in live mode, `architect` in architect mode. */
export type OpSet = "board" | "architect";

/** Board ops architect mode keeps, in tool order. No zone ops: the app makes the one system zone. */
const ARCHITECT_KEPT = ["add_component", "connect", "update_label", "delete"] as const;

/** The field that puts a drawing op under a proposal (architect mode): without it, what is drawn is ink. */
const proposalField = () =>
  id("Id of the open proposal this belongs to (see propose); it is drawn in pencil. Leave it out for what the user asked for: that is drawn in ink.").optional();

/** Kept ops whose description says more in architect mode, where groups exist. */
const ARCHITECT_KEPT_DESCRIPTIONS: Partial<Record<(typeof ARCHITECT_KEPT)[number], string>> = {
  add_component:
    "Adds a component to the system zone. type: actor = person (stick figure); client = browser or phone; service = service box; database = cylinder; queue = queue or pipe; storage = bucket or folder; external = dotted cloud of a third party. 'parent' puts it inside a group.",
  connect: "Draws an arrow between two components. Arrows join components only, never a group.",
  update_label: "Changes the text of a component, group or connection.",
  delete: "Deletes a component, group or connection. Never the system zone: it stays for the whole session. Deleting a component removes its arrows; deleting a group keeps what was inside it, moved up to the group's own parent.",
};

/** Input schema per architect-only op, in the order Claude sees the tools. */
const ARCHITECT_INPUTS = {
  say: z.strictObject({
    text: text("What you tell the user: about 25 words, concrete, at most one question."),
    target: id("Id of the element, group or proposal the bubble is about (optional; without it the bubble comes from a corner).").optional(),
  }),
  add_group: z.strictObject({
    id: id("Unique identifier."),
    kind: z
      .enum(GROUP_KINDS)
      .describe(
        "aws_cloud = the AWS Cloud around everything on AWS; region = an AWS Region; vpc = a VPC; availability_zone = one Availability Zone; public_subnet = a subnet reachable from the internet; private_subnet = a subnet with no route from the internet; generic = any other boundary (an on-premises network, an account).",
      ),
    label: text("Short label, e.g. 'VPC' or 'us-east-1a'."),
    parent: id("Id of the group it sits in (optional; without it, at the top of the zone).").optional(),
  }),
  set_parent: z.strictObject({
    id: id("Id of the component or group to move."),
    parent: z.string().min(1).refine(notBlank, "must not be blank").nullable().describe("Id of the group to move it into; null takes it out of every group."),
  }),
  propose: z.strictObject({
    id: id("Unique identifier of the proposal, e.g. 'P1'."),
    label: text("What it is, in 1 to 4 words, e.g. 'Static site'."),
    alternative_to: id("Id of an open proposal this one is the other choice to (optional; at most 2 side by side).").optional(),
  }),
  accept: z.strictObject({ proposal: id("Id of the open proposal the user keeps.") }),
  reject: z.strictObject({ proposal: id("Id of the open proposal the user turns down.") }),
};

const ARCHITECT_DESCRIPTIONS: Record<keyof typeof ARCHITECT_INPUTS, string> = {
  say: "Speaks to the user in a speech bubble over the board. Exactly one per turn, even when nothing is drawn; if you send more than one, only the last is shown.",
  add_group:
    "Draws an AWS group: a labelled box that holds components and other groups (AWS Cloud > Region > VPC > Availability Zone > subnet). The parent group must already exist. Put components in it with add_component's 'parent'. An empty group is drawn at a minimum size.",
  set_parent:
    "Moves a component or group into another group, or out of every group with parent null. A group cannot go inside itself or inside a group it contains.",
  propose:
    "Opens a proposal: something you add on your own initiative, drawn in pencil until the user keeps it. Call it before the add_component, add_group and connect calls that carry its id in 'proposal'. 'alternative_to' makes it the other choice to an open proposal, drawn beside it; the user keeps one of the two.",
  accept: "Keeps an open proposal: everything drawn under it turns to ink. Accepting one of two alternatives erases the other.",
  reject: "Turns down an open proposal: everything drawn under it is erased, with the arrows that touch it.",
};

// ---- Icon catalogs (optional) ----
// When on, the elements that can carry a service icon get `service`, and set_service appears
// (just before update_summary, which stays last). When off, Claude sees nothing of the catalog.

/** Operations that take a `service` when a catalog is on. */
const SERVICE_OPS = ["add_step", "add_decision", "add_component"] as const;
const SET_SERVICE_DESCRIPTION =
  "Puts on or changes the AWS service icon of an element already drawn (any type). An empty service removes it.";

type InputSchema = { name: OpName; description: string; schema: z.ZodType };

/** Input schemas for one op set and catalog set: `serviceIds` empty = catalogs off. */
export function inputSchemas(serviceIds: readonly string[], set: OpSet = "board"): InputSchema[] {
  const board = boardSchemas(serviceIds);
  if (set === "board") return board;
  const named = (name: OpName) => board.filter((t) => t.name === name);
  const kept = ARCHITECT_KEPT.flatMap(named).map((t) => {
    const description = ARCHITECT_KEPT_DESCRIPTIONS[t.name as (typeof ARCHITECT_KEPT)[number]] ?? t.description;
    if (t.name === "connect") return { ...t, description, schema: z.strictObject({ ...CONNECT_SHAPE, proposal: proposalField() }).refine(twoEnds, SAME_ENDS) };
    if (t.name !== "add_component") return { ...t, description };
    const parent = id("Id of the group it sits in (optional; without it, outside every group).").optional();
    return { ...t, description, schema: (t.schema as z.ZodObject).extend({ parent, proposal: proposalField() }) };
  });
  // Proposals only add: of the architect's own ops, only add_group draws something new.
  const own = (Object.keys(ARCHITECT_INPUTS) as (keyof typeof ARCHITECT_INPUTS)[]).map((name) => ({
    name: name as OpName,
    description: ARCHITECT_DESCRIPTIONS[name],
    schema: name === "add_group" ? ARCHITECT_INPUTS.add_group.extend({ proposal: proposalField() }) : (ARCHITECT_INPUTS[name] as z.ZodType),
  }));
  return [...kept, ...own, ...named("set_service"), ...named("update_summary")];
}

function boardSchemas(serviceIds: readonly string[]): InputSchema[] {
  const base = (Object.keys(INPUTS) as (keyof typeof INPUTS)[]).map((name) => ({
    name: name as OpName,
    description: DESCRIPTIONS[name],
    schema: INPUTS[name] as z.ZodType,
  }));
  if (!serviceIds.length) return base;
  const [first, ...rest] = serviceIds;
  const service = z.enum([first, ...rest]).describe("AWS service (icon). Only if the speaker names it or there is no doubt.");
  const patched = base.map((t) =>
    (SERVICE_OPS as readonly string[]).includes(t.name)
      ? { ...t, schema: INPUTS[t.name as (typeof SERVICE_OPS)[number]].extend({ service: service.optional() }) }
      : t,
  );
  const setService = {
    name: "set_service" as OpName,
    description: SET_SERVICE_DESCRIPTION,
    schema: z.strictObject({
      id: id("Id of the element."),
      service: z.enum([...serviceIds, ""]).describe("Service id; empty to remove it."),
    }),
  };
  return [...patched.slice(0, -1), setService, patched[patched.length - 1]];
}

// ---- Types ----

type BaseInputs = { [K in keyof typeof INPUTS]: z.output<(typeof INPUTS)[K]> };
type WithService<T> = T & { service?: string };

export type OpInputs = Omit<BaseInputs, (typeof SERVICE_OPS)[number] | "connect"> & {
  add_step: WithService<BaseInputs["add_step"]>;
  add_decision: WithService<BaseInputs["add_decision"]>;
  /** `parent` (a group id) and `proposal` only in the architect set. */
  add_component: WithService<BaseInputs["add_component"]> & { parent?: string; proposal?: string };
  /** `proposal` only in the architect set. */
  connect: BaseInputs["connect"] & { proposal?: string };
  /** Service icon for any element; an empty `service` removes it. Only with a catalog on. */
  set_service: { id: string; service: string };
  /** Architect mode only: the turn's speech bubble. */
  say: z.output<typeof ARCHITECT_INPUTS.say>;
  /** Architect mode only: an AWS group, optionally inside another; in pencil under a proposal. */
  add_group: z.output<typeof ARCHITECT_INPUTS.add_group> & { proposal?: string };
  /** Architect mode only: moves a component or group into a group, or out of every group (null). */
  set_parent: z.output<typeof ARCHITECT_INPUTS.set_parent>;
  /** Architect mode only: opens a proposal, drawn in pencil, optionally the other choice to an open one. */
  propose: z.output<typeof ARCHITECT_INPUTS.propose>;
  /** Architect mode only: the proposal turns to ink (its alternative, if any, is erased). */
  accept: z.output<typeof ARCHITECT_INPUTS.accept>;
  /** Architect mode only: what was drawn under the proposal is erased. */
  reject: z.output<typeof ARCHITECT_INPUTS.reject>;
};
export type OpName = keyof OpInputs;
export type Op = { [K in OpName]: { name: K; input: OpInputs[K] } }[OpName];

type OpBuilders = { [K in OpName]: (input: OpInputs[K]) => { name: K; input: OpInputs[K] } };
/** Typed builders: op.add_step({...}) -> {name:"add_step", input:{...}} */
export const op = new Proxy({} as OpBuilders, {
  get: (_t, name: string) => (input: unknown) => ({ name, input }),
});
