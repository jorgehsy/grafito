# Notice: AWS Well-Architected Framework

This folder holds the **Well-Architected digest**: the titles of the AWS Well-Architected Framework that Claude works from in architect mode. It is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (see `LICENSE`), not under the MIT license of the rest of the repository, because it is adapted from AWS documentation, which AWS licenses under CC BY-SA 4.0 (https://aws.amazon.com/terms, "License and site access").

## Source

- Work: "AWS Well-Architected Framework" by Amazon Web Services, Inc. or its affiliates, https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- Revision: publication date **November 6, 2024**, as shown on the welcome page when it was read on 2026-11-01.
- License of the source: CC BY-SA 4.0.

## Changes (adapted material)

- Extracted only titles: the general and per-pillar design principles, the 57 questions and the 307 best practices, with their IDs (`REL 10`, `REL10-BP01`). No guidance text, descriptions, anti-patterns or implementation steps.
- Reorganized into pillar > question > best practice data (`src/framework.generated.ts`) and a compact prompt text (`renderWellArchitectedDigest()` in `src/digest.ts`).
- Pillar definitions (`src/pillars.ts`) are one-line summaries written in our own words, not AWS text.

## Refresh

Run `pnpm --filter @grafito/wellarchitected wa:fetch` by hand. `scripts/fetch-wellarchitected.ts` rebuilds `src/framework.generated.ts` from the live framework and writes nothing if any page is missing or does not parse. After a refresh, update the revision date above and the counts in `src/digest.test.ts`.

The script reads the pages through the public AWS Knowledge MCP server (`https://knowledge-mcp.global.api.aws`, no authentication, https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) with its `aws___read_documentation` tool instead of fetching docs.aws.amazon.com directly: it returns each page as clean markdown, so there is no HTML to scrape, and it is reachable from environments where docs.aws.amazon.com is blocked. Calls are sequential with a short pause, because the server's rate limits are not published.

Amazon Web Services, AWS and AWS Well-Architected are trademarks of Amazon.com, Inc. or its affiliates. Grafito is not affiliated with or endorsed by AWS.
