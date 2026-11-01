# What Well-Architected guidance does Claude need, and how does it get it?

Research for #33 (part of #31, architect mode). Findings only, no decision. Researched 2026-10-31.

How the numbers were produced: the framework PDF was downloaded and converted with `pdftotext`; the AWS Knowledge MCP server was called directly over HTTP (JSON-RPC) and through the MCP tools. Token counts are estimates (chars / 4; words x 1.35 gives a lower bound). No `count_tokens` call was made. Latencies are single-digit samples from one machine (macOS, residential connection), not a benchmark.

## 1. Structure and size of the Framework

Source of truth: AWS Well-Architected Framework, https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html. The welcome page states "Publication date: November 6, 2024". The full PDF at https://docs.aws.amazon.com/pdfs/wellarchitected/latest/framework/wellarchitected-framework.pdf was generated 2026-10-31 (1003 pages). The doc site also serves dated snapshots (`/2022-03-31/`, `/2023-10-03/`, `/2024-06-27/`, `/2025-02-25/` and `/latest/` all appear in search results), so the content is revised about once or twice a year.

Hierarchy (counted from the PDF text):

| Level | Count | Notes |
| --- | ---: | --- |
| Pillars | 6 | Operational excellence, Security, Reliability, Performance efficiency, Cost optimization, Sustainability (https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html) |
| General design principles | 6 | Cross-pillar, plus 5-8 design principles per pillar |
| Best-practice focus areas | 4-7 per pillar | e.g. Reliability: Foundations, Workload architecture, Change management, Failure management |
| Questions | 57 | OPS 11, SEC 11, REL 13, PERF 5, COST 11, SUS 6 (IDs like `REL 10`) |
| Best practices | 310 | OPS 68, SEC 64, REL 66, PERF 33, COST 50, SUS 29 (IDs like `REL10-BP01`) |

Each pillar page has: Design principles, Definition, Best practices (grouped by question), Resources (e.g. https://docs.aws.amazon.com/wellarchitected/latest/framework/reliability.html). A question page (`rel-10.html`) is about 570 chars: the question, a one-paragraph intro and the list of BP titles. A best-practice page (`rel_fault_isolation_multiaz_region_system.html`) is about 19,400 chars (about 4.9k tokens): level of risk, desired outcome, anti-patterns, benefits, implementation guidance, steps, resources.

Size (PDF text, includes TOC and page headers):

| Slice | Words | Approx. tokens |
| --- | ---: | ---: |
| Whole framework | 283,728 (2.17 MB) | 380k-540k |
| Operational excellence | 49k | 65k-90k |
| Security | 63k | 85k-115k |
| Reliability | 70k | 95k-125k |
| Performance efficiency | 25k | 33k-45k |
| Cost optimization | 39k | 52k-70k |
| Sustainability | 16k | 21k-29k |
| Intro + general principles + TOC | 21k | |
| **Titles only**: 57 questions + 310 best-practice titles (with IDs) | 2.7k words, 20 KB | about 5k |
| Six pillar definitions + all design-principle titles | | about 1-2k (estimate) |

So a "digest" of pillars + principles + every question and BP title is about 6-8k tokens. The whole text is 400-550k tokens and fits the 1M context of Sonnet 5.5 but is not a sensible prompt.

### Lenses

Lenses are separate documents that narrow the framework to a workload type. AWS-maintained ones live in the "Lens Catalog"; users can also author custom lenses (https://docs.aws.amazon.com/wellarchitected/latest/userguide/lenses.html). I did not enumerate the catalog.

Serverless Applications Lens (https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html): "Publication date: July 14, 2022". It covers six scenarios (RESTful microservices, Alexa skills, mobile backend, streaming processing, web application, event-driven architectures; `.../scenarios.html`) and then the pillars, covering "only details ... specific to serverless workloads". It is four years old at the time of research, so it predates newer serverless services. Its PDF was not found at the obvious URL (404), so its size was not measured.

New (not investigated): the user-guide page now describes an "AWS Well-Architected Agent" in preview, "Last updated: October 1, 2026" (https://docs.aws.amazon.com/wellarchitected/latest/userguide/well-architected.html). It reviews deployed resources and IaC, so it is a different product from the framework text, but it may matter later.

### What Claude already knows

Not measured. Informal, unblinded spot check by the researching agent (Claude Sonnet 5.5), about ten items compared against the PDF: question titles `SEC 1`, `SEC 8`, `REL 2`, `REL 10`, `COST 1`, `OPS 4` and BP titles `REL10-BP01`, `SEC08-BP02`, `SUS02-BP01` matched; the exact wording of `PERF 1` was recalled only in part. That says the pillars, question titles and well-known BPs are in the model, not how reliably it recalls IDs, the 2022-2025 renumbering, lens content or the newest services. The versioned snapshots above mean training data likely mixes several revisions. A real answer needs a small eval (e.g. 30 prompts of the form "which BP covers X", graded against the PDF). The existing eval script in `apps/server` is the place for it.

## 2. Ways to bring it into a turn

Context from the repo: `apps/server/src/prompt/system.ts` is about 10 KB (about 2.6k tokens) and is already sent as a cached block (`cache: true`; language line outside the cache). Both adapters are single-turn: `anthropic.ts` makes one `messages.create`, and `subscription.ts` uses the Agent SDK with `maxTurns: 1`, `strictMcpConfig: true` and only an in-process `sdk` MCP server (ADR 0004, `docs/adr/0004-model-providers.md`). Models and prices are in `packages/contract/src/models.ts`: Sonnet 5.5 at $2 input / $2.50 cache write / $0.20 cache read / $10 output per million tokens, Haiku 5.5 at $0.10 / $0.125 / $0.01 / $0.50 (Haiku is priced higher above 100K-token prompts). Plan models have no per-token price.

Caching facts (from the Claude API skill's `shared/prompt-caching.md`, which mirrors https://platform.claude.com/docs/en/build-with-claude/prompt-caching): prefix match, order `tools` -> `system` -> `messages`; minimum cacheable prefix 512 tokens on Sonnet 5.5 and Haiku 5.5; default TTL 5 minutes, refreshed on each read, optional 1 hour (`ttl: "1h"`, write costs 2x); cache write 1.25x base input, read about 0.1x; up to 4 breakpoints; caches are per workspace. A cache miss in a conversation with gaps over 5 minutes re-pays the write.

### A. Summary in the system prompt (cached)

- What: pillars, principles, and all question and BP titles with IDs (about 6-8k tokens), written into the prompt, with an instruction to name the BP ID in the speech bubble when relevant.
- Size: +6-8k tokens on top of 2.6k.
- Cost per turn (8k tokens): Sonnet 5.5 about $0.0016 on a cache hit, $0.020 on a write, $0.016 if not cached; Haiku 5.5 about $0.00008 hit, $0.001 write. Added to the existing prefix, which already pays the same way.
- Latency: no extra round trip; a larger prefill, mostly cached.
- Freshness: as of the build date; refresh by a script, like the icon fetch script in `packages/icons`.
- Gives Claude the map and the vocabulary, not the guidance text (titles only). Claude would still answer "why" from its own memory.

### B. Bundled excerpts picked per topic

- What: store question pages (about 150 tokens each) or BP pages (about 2.5k tokens each at the MCP default 10k-char cap, about 5k full) in the repo; the server selects some per turn (by zone kind / service in the board, or by keyword) and adds them to the user text, after the cache breakpoint.
- Size: for example 3 BP pages is 7.5k-15k tokens; 5 question pages is under 1k.
- Cost per turn: uncached, so 7.5k tokens is about $0.015 on Sonnet 5.5, $0.00075 on Haiku 5.5. If the same excerpts repeat across turns of one topic and sit in a second cached block, reads are about 10x cheaper.
- Latency: no extra round trip. The router (a keyword map, or letting Claude ask via the digest in A) is the added complexity.
- Freshness: as of the bundle date, refreshed by a script. Redistribution terms for AWS documentation text were not checked; check before committing bulk copies of the docs to the repo.

### C. Live lookup by Claude (tool call to an MCP server)

AWS Knowledge MCP server: endpoint `https://knowledge-mcp.global.api.aws`, Streamable HTTP, no authentication or AWS account, "subject to rate limits" (no numbers published), "in general availability" (https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server). Indexed sources include "Architectural references and Well-Architected guidance". Tools (confirmed with `tools/list`, 7.9 KB, about 2k tokens of tool definitions): `aws___search_documentation` (parameters `search_phrase`, `limit` default 4, `topics`; default topic `general` covers "architecture, best practices"), `aws___read_documentation` (`requests: [{url, max_length default 10000, start_index}]`), `aws___retrieve_skill`, `aws___list_regions`, `aws___get_regional_availability`. A third-party listing says AWS recommends moving to the "AWS MCP Server"; the official page above does not say so (unverified).

Measured against the live endpoint:

| Call | Latency | Response |
| --- | ---: | --- |
| `tools/list` | 0.54 s | 7.9 KB |
| `search_documentation` (broad query: serverless lens) | 1.68 s | 7.8 KB (about 2k tokens) |
| `search_documentation` ("REL10 fault isolation multiple locations", limit 5) | 1.66 s | 4.3 KB (about 1k tokens) |
| `read_documentation` of `rel-10.html` | 0.79 s | 0.8 KB |
| `read_documentation` of a BP page | 0.83 s | 10.7 KB (capped at 10k chars) |

Observations: search returns verbatim page chunks, not summaries. For the REL 10 query, all five results were the same question page in five different versions (`2022-03-31`, `2023-10-03`, `2024-06-27`, `2025-02-25`, `latest`), so 4 of 5 results were duplicates of older revisions. A broad query returned a partner blog post, not the lens. Result quality for Well-Architected needs its own test set.

Two ways to wire it:

1. Claude calls the tool itself. With the API, the MCP connector needs beta `mcp-client-2025-11-20`, `mcp_servers: [{type: "url", url, name}]` and a matching `tools: [{type: "mcp_toolset", mcp_server_name}]`; Anthropic makes the call server-side, so no client loop is needed (https://platform.claude.com/docs/en/agents-and-tools/mcp-connector). Availability: Claude API beta, Claude Platform on AWS beta, Foundry beta, not on Bedrock or Vertex (Claude API skill, `shared/platform-availability.md`). With the subscription adapter, the Agent SDK can attach a remote MCP server, but today's adapter sets `maxTurns: 1` and `strictMcpConfig`, and the ADR records that more turns made Claude repeat ops, so a tool round trip changes that design. Not tested here.
   - Cost per turn: tool definitions about 2k tokens (cacheable); each lookup adds about 1-2k tokens of result as uncached input (about $0.002-0.004 on Sonnet 5.5) plus a few output tokens for the call; 1-3 lookups per turn is typical, so roughly $0.005-0.012 plus a second model request.
   - Latency: at least one extra model round trip plus 0.8-1.7 s of tool time (measured), before the speech bubble and ops can finish. This is the largest cost for a conversation that is meant to feel live.
2. The server looks up before calling Claude. The server issues the same JSON-RPC calls itself (as in the measurements above), picks the query from the user's utterance and the board, and puts the chunks in the user text. This keeps both adapters single-turn and works on any provider. Cost: same tokens as above, no tool definitions; latency: 0.8-1.7 s in series before the model call (could overlap with other work); the query has to be chosen without the model unless a cheap Haiku call writes it (extra round trip).

Freshness for C: live ("Real-time access to AWS documentation" on the official page; no indexing lag published). Risks: third-party availability and unpublished rate limits for a demo; result duplicates across versions; internet access required.

### D. Whole framework in the prompt (for reference)

400-550k tokens: Sonnet 5.5 cache write about $1.0-1.4 and read about $0.08-0.11 per turn; Haiku 5.5 is priced higher above 100K tokens ($0.50/M input; the cache rates for that tier were not checked). The 5-minute TTL means any pause longer than that re-pays the write. Listed only to bound the range.

## 3. Comparison

| | Size added per turn | Cost per turn, Sonnet 5.5 (Haiku 5.5) | Extra latency | Freshness | Gives |
| --- | --- | --- | --- | --- | --- |
| A. Digest in cached prompt | 6-8k tokens | $0.0016 hit / $0.020 write ($0.00008 / $0.001) | none | build date | IDs and titles, vocabulary |
| B. Bundled excerpts | 1-15k tokens | $0.002-0.03 uncached ($0.0001-0.0015) | none (router logic) | build date | guidance text on the topic at hand |
| C1. Claude calls MCP | 2k tool defs + 1-2k per lookup | about $0.005-0.012 plus extra request | extra model round trip + 0.8-1.7 s per lookup | live | any page, chosen by Claude |
| C2. Server pre-fetches via MCP | 1-2k per lookup | about $0.002-0.006 | 0.8-1.7 s in series | live | pages chosen by server heuristics |
| D. Whole text | 400-550k tokens | about $0.08-0.11 hit / $1.0-1.4 write | large prefill | build date | everything |

Costs are input-side only; output tokens (a ~25-word bubble plus ops) are the same in every option.

## 4. Open questions for the decision

- How good is Claude without any of this? An eval on question and BP recall and on "does the advice cite a real BP" would settle whether A alone is enough.
- Does the architect-mode answer need to quote guidance, or only to be consistent with it? Only quoting needs B or C.
- Does the subscription adapter need to behave like the API one? C1 differs between them; A, B and C2 do not.
- AWS documentation redistribution terms, and MCP rate limits, are unchecked.

## Sources

- Framework welcome (publication date) https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- Pillars list https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html
- Framework PDF https://docs.aws.amazon.com/pdfs/wellarchitected/latest/framework/wellarchitected-framework.pdf
- Reliability pillar page https://docs.aws.amazon.com/wellarchitected/latest/framework/reliability.html; question page https://docs.aws.amazon.com/wellarchitected/latest/framework/rel-10.html
- Serverless Applications Lens https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html and `.../scenarios.html`
- Lenses in the WA Tool https://docs.aws.amazon.com/wellarchitected/latest/userguide/lenses.html; WA Tool and Agent https://docs.aws.amazon.com/wellarchitected/latest/userguide/well-architected.html
- AWS Knowledge MCP server https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server (endpoint `https://knowledge-mcp.global.api.aws`)
- Prompt caching https://platform.claude.com/docs/en/build-with-claude/prompt-caching; MCP connector https://platform.claude.com/docs/en/agents-and-tools/mcp-connector (facts taken from the Claude API skill's `shared/prompt-caching.md`, `shared/tool-use-concepts.md` and `shared/platform-availability.md`; the docs pages themselves were not re-fetched)
- Repo: `apps/server/src/claude/anthropic.ts`, `apps/server/src/claude/subscription.ts`, `apps/server/src/prompt/system.ts`, `packages/contract/src/models.ts`, `docs/adr/0004-model-providers.md`
