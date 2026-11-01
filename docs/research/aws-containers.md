# How should architect mode draw AWS containers?

Research for #32 (part of #31). Findings and options only; no decision.

Snapshot: branch `main` at `8ad5fd2`, AWS icon package `07312026` (the version `packages/icons` pins at `packages/icons/src/aws/services.ts:4`).

## 1. What AWS says

Sources: the official icon page <https://aws.amazon.com/architecture/icons/> and the two downloads it links (read directly): the Icon package zip and the "Microsoft PPTx toolkits" zip (`AWS-Architecture-Icons-Deck_For-Light-BG_07312026.pptx`, 156 slides; slide numbers below are from it). The web page itself says nothing about groups; the guidance lives in the deck.

- **Groups are a separate asset class.** Slide 8: "Groups: show the connections between multiple services or resources". Slide 14: "Each group consists of an icon and a label. Colors and lines help to differentiate groups". "Some groups cross multiple groups, such as Auto Scaling, while others are meant to nest inside another, such as a VPC and subnets." Nested inner groups keep a small buffer on all sides (">= .05 inch"). Do: use the generic group if no preset fits; do not resize group icons or use non-approved icons.
- **Nesting shown on slide 9 and example slide 21:** AWS Cloud > Region > VPC > Availability Zone > subnet > resources, with an Auto Scaling group crossing AZs.
- **Slide 25 ("Groups 1/5") lists the presets.** Border colour and line style, extracted from the slide XML:

| Group | Border colour | Line | Has an icon file in the package? |
|---|---|---|---|
| AWS Cloud | (dark, logo tab) | solid | yes: `AWS-Cloud_32.svg`, `_Dark`, and `AWS-Cloud-logo_32.svg` (cloud-icon variant for regions where the "AWS" logo cannot be used, slide 25 note) |
| Region | `#00A4A6` | sysDash (dotted) | yes: `Region_32.svg` |
| Availability Zone | `#00A4A6` | dash | **no**: box only, no icon |
| Security group | `#DD344C` | solid | **no**: box only, no icon |
| Auto Scaling group | `#ED7100` | dash | yes: `Auto-Scaling-group_32.svg` |
| VPC | `#8C4FFF` | solid | yes: `Virtual-private-cloud-VPC_32.svg` |
| Private subnet | `#00A4A6` | solid | yes: `Private-subnet_32.svg` |
| Public subnet | `#7AA116` | solid | yes: `Public-subnet_32.svg` |
| Generic group | `#7D8998` | dash or solid | no |

Also in the package's `Architecture-Group-Icons_07312026/`: Server contents, Corporate data center, EC2 instance contents, Spot Fleet, AWS account, AWS IoT Greengrass Deployment (15 SVGs in all, each a 40x40 coloured square with a white glyph, e.g. Region `fill="#00A4A6"`). Slide 26 says all groups are editable and a custom group takes the category colour of its service.

Not found in any source: a rule for label placement beyond "icon + label" (the icon square sits at the top-left corner of the box in the deck's examples; I did not verify this numerically).

## 2. What grafito has today

- **No container concept.** The board is `zones` (topic boxes) holding flat `elements`: `Zone`/`Element` in `packages/board/src/model.ts:5-45`. An element belongs to exactly one zone (`Element.zone`, `model.ts:24`); `after`/`parent` only create arrows (`derivedConnections`, `model.ts:81-90`). Nothing nests.
- **A zone is not a container.** It is a titled kind-specific box; the system zone accepts only `component` (`ELEMENT_ZONE`, `model.ts:71-73`) with types actor/client/service/database/queue/storage/external (`packages/contract/src/ops.ts:11`). `GLOSSARY.md` lists "group" under _Avoid_ for Zone (line 13).
- **Ops.** `create_zone`, `add_component`, `move_to_zone`, `delete` (`ops.ts:32-82`, `model.ts:335-372`). No op takes a parent container. `add_component` can carry an AWS `service` icon (`ops.ts:57-63, 185`, `model.ts:155-160`). Deleting a zone deletes its content (`model.ts:337-343`), which is the nearest thing to container semantics.
- **Icons.** `packages/icons` has 44 curated service icons from `Architecture-Service-Icons_07312026` (`services.ts:4-8`, `scripts/fetch-aws-icons.ts`). A `vpc` *service* icon exists (`services.ts:32`) but no group icons (Region, subnet, ASG, ...) and the script only reads the service folder.
- **Layout.** `layoutZone` (`packages/board/src/layout/zones.ts:18-`) lays out one zone's elements with ELK for flow and system. The ELK graph is flat: `children` are just the elements, no nested `children` (`packages/board/src/layout/elk.ts:32`), options at `elk.ts:12-28`. Zone size = content + padding (`zones.ts:49-60`); zones are packed in rows, `place` allows `right_of`/`below` (`zones.ts:73-96`). Cross-zone connections are routed by an A* router that treats zones as costly regions and elements as obstacles (`packages/board/src/route.ts:1-3, 49`; called from `layout/index.ts:47-70`). The layout result has one `zones` rect map and one `elements` map (`layout/types.ts:11-27`); there is no rect-for-container.
- **Render.** The web engine draws the zone layer, then connections, elements, annotations (`apps/web/src/render/engine.ts:65, 85, 353-354`); a zone is a header box sized from its title. Render items come from `packages/board/src/tree.ts` keyed by `kind: "zone" | "element" | ...`.
- **Session record.** Saved sessions are versioned (`packages/contract/src/record.ts`, `PROMPT_VERSION = 2` at line 6); any change to op or tool definitions needs a hash update and a version bump (`docs/adding-a-zone-kind.md:20`).

## 3. The gap

For a hierarchy AWS Cloud > Region > VPC > AZ > subnet > service (plus SG and ASG crossing it):

| Layer | Missing |
|---|---|
| Model | A parent link between containers and from elements to a container; container kind (cloud, region, vpc, az, subnet-public/private, sg, asg, generic) with label (and optional CIDR). Elements in more than one group (SG, ASG) do not fit "exactly one parent". |
| Ops | A way to create a container and put things in it (`add_group`, or `parent`/`in` on `add_component`), plus move into/out of a group. `delete` semantics for a container with children. The `connect` op needs no change. |
| Layout | Compound layout: the container's rect must come from its children's layout plus padding and a header, recursively. ELK supports this, but only when children are nested in the graph; `hierarchyHandling: INCLUDE_CHILDREN` lays "a node and all of its descendants in a single layout run" ([ELK reference](https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html)), which keeps edges across container boundaries routable. Today each zone is its own ELK run and the router sees zones only as cost. |
| Render | A group box with its coloured border (solid/dash/dot per table above), a corner icon square and label; drawn behind its children and nested; the engine has no such layer. Hand-drawn/"pencil" style (architect mode proposals) must apply to the boxes too. |
| Icons | Group icons are not in `packages/icons`; AZ and Security group have none in the official package (box only). |

## 4. Options, cheapest first

### A. Containers are drawn by the board, no new model (cheapest)
Keep one system zone per diagram, with a convention: Claude names a zone "VPC 10.0.0.0/16" and puts the components in it; use `create_zone` with `place`, plus the existing `vpc` service icon. Nested containers become several zones side by side.
- Cost: prompt text only (and hash bump). No layout work.
- Trade-offs: no real nesting (a subnet cannot sit visually inside a VPC), no AZ/subnet/SG look, cross-zone arrows go through the router around zone boxes. Does not satisfy the AWS conventions in section 1. Fine as a stopgap to test the turn protocol.

### B. One level of group inside a system zone (flat groups)
Add a group element/field: `Element.group?: string` (or a `group` element type) with a `kind` from the table in section 1, drawn as a coloured box around the members laid out by ELK as one level of compound nodes.
- Cost: model field + one op (`add_group` / `group` param on `add_component`) + ELK compound children for one level + one render layer + a group-style table (colour, dash, optional icon); 8 group SVGs to add to `packages/icons` (6 have files; AZ, SG are box only).
- Trade-offs: covers "subnet in a zone" and "AZ" well; VPC around AZs needs a second level. Peer groups that cross (ASG across AZs, SG) are still not expressible.

### C. Full nesting: containers as a tree of groups, ELK hierarchy
`Group { id, kind, label, parent? }` in the board, `Element.group`, recursive ELK compound layout with `INCLUDE_CHILDREN`, recursive rects in `BoardLayout`, nested render with AWS borders, icons added to `packages/icons`. SG/ASG as overlay (outline around members, no layout effect) or via `connect`-like membership.
- Cost: highest: model, ops (+ `delete`/`move` rules), layout rewrite for the system zone (also the label placement and emphasis circle code in `elk.ts:35-70` assume a flat result), engine layer, record version bump, prompt text, tests.
- Trade-offs: matches AWS diagrams (slides 9, 21) and Well-Architected discussions about AZs; is the only option where Claude can say "move this to the other AZ" and have the box follow. Also the one that most changes `ARCHITECTURE.md` and probably warrants an ADR (hard to reverse).

## Open facts to check before choosing
- Whether architect mode needs SG/ASG as boxes or only as labels on a service (the deck draws them as boxes).
- Whether architect mode lives in the existing system zone or a new zone kind (`docs/adding-a-zone-kind.md` lists the touch points either way).
- ELK's behavior with the project's existing options (`NETWORK_SIMPLEX`, `separateConnectedComponents`) inside compound nodes: not tested here.

## Sources
- AWS Architecture Icons page: <https://aws.amazon.com/architecture/icons/>
- Icon package 07312026 (group SVGs): <https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip>
- PPTx toolkit 07312026 (guidelines slides 8, 9, 14, 21, 25, 26): <https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Microsoft-PPTx-toolkits_07312026.1c286c4a809a3cf2902c88ff63bf7dd1fa3cd55d.zip>
- ELK hierarchy handling: <https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html>
- AWS VPC subnets (public/private subnets per AZ): <https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html>
