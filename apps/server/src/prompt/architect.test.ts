import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ARCHITECT_PROMPT_VERSION, LANGS, toolDefs } from "@grafito/contract";
import { AWS_SERVICES } from "@grafito/icons";
import { renderWellArchitectedDigest } from "@grafito/wellarchitected";
import { ARCHITECT_SYSTEM_PROMPT, WELL_ARCHITECTED_DIGEST, architectSystemPrompt, buildArchitectUserText } from "./architect";
import { BOARD_SYSTEM_PROMPT, languageLine, systemPrompt } from "./system";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("architect system prompt", () => {
  it("prompt and tools are byte for byte the reviewed version", () => {
    expect(sha(ARCHITECT_SYSTEM_PROMPT)).toBe("92cb983ae740ff3745751337bc38e880d19c800afd416b22285d548dea3e0220");
    expect(sha(WELL_ARCHITECTED_DIGEST)).toBe("832d66dfb0b386561a47bbc433cfe764bb9e1a64e86d3c34a133c2e1a4a363be");
    expect(sha(JSON.stringify(toolDefs([], "architect")))).toBe("5bf988abc9745e8567ad86d5fa38fefd529220f18f1464480f98727c39d0055d");
  });

  it("every change to the architect prompt, digest, tools or user text bumps ARCHITECT_PROMPT_VERSION", () => {
    // Saved architect turns stamp ARCHITECT_PROMPT_VERSION, so a version must always mean the same prompt. On any
    // change: bump ARCHITECT_PROMPT_VERSION and add its hash here; never edit a hash already listed.
    const PINNED: Record<number, string> = {
      1: "2f330fb826cb88a9a072e9155337218230fd700465bdcb378e7ddf7329e8120d",
      2: "d76b6d52bdd388574b410eaa3a4d286ddc5036c4847233b11f50f8582d12d787",
    };
    const userText = buildArchitectUserText({ board: "B", summary: "s", recent: [{ text: "t", bubble: "b" }], actions: [{ type: "accept", proposal: "P1" }], text: "next" });
    const all = [ARCHITECT_SYSTEM_PROMPT, WELL_ARCHITECTED_DIGEST, JSON.stringify(toolDefs([], "architect")), JSON.stringify(toolDefs(["aws"], "architect")), userText];
    expect({ version: ARCHITECT_PROMPT_VERSION, hash: sha(all.join("\n\u0000\n")) }).toEqual({ version: ARCHITECT_PROMPT_VERSION, hash: PINNED[ARCHITECT_PROMPT_VERSION] });
  });

  it("is the architect prompt and the digest, cached, then the same language line as live mode, not cached", () => {
    expect(architectSystemPrompt({ catalogs: [], lang: "es-CL" })).toEqual([
      { text: `${ARCHITECT_SYSTEM_PROMPT}\n\n${WELL_ARCHITECTED_DIGEST}`, cache: true },
      { text: languageLine("es-CL") },
    ]);
    const cached = new Set(LANGS.map((l) => JSON.stringify(architectSystemPrompt({ catalogs: ["aws"], lang: l.code })[0])));
    expect(cached.size).toBe(1);
  });

  it("rule 6: the say's target is an element, group or proposal", () => {
    expect(ARCHITECT_SYSTEM_PROMPT).toContain("Set its target to the id of the element, group or proposal it is about");
  });

  it("carries the persona rules", () => {
    for (const rule of [/Draw first/, /One question per turn/, /No lectures/, /what happens if/, /Blunt, not blocking/, /Push back once/, /exactly one say/, /Out of scope/, /draw nothing/, /AWS service names stay in English/, /language named on the last line/])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
  });

  it("numbers its rules 1 to 16 in order, once each", () => {
    const numbers = [...ARCHITECT_SYSTEM_PROMPT.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: 16 }, (_, k) => k + 1));
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/pillar review \(rule 10\)/);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/^10\. An end\./m);
  });

  it("explains ink and pencil: propose, the proposal field, accept and reject, the board tags", () => {
    for (const rule of [/propose/, /give its id as proposal on every add_component, add_group and connect/, /\[pencil P3\]/, /PROPOSALS lists the open ones/, /listed as A and B/, /accepting one of two alternatives erases the other/, /reject erases it/, /Proposals only add/])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
  });

  it("carries the proposal rules: draw first as proposals, ink vs pencil, alternatives, keep these, typed answers, changing ink", () => {
    for (const rule of [
      /draw it in this turn as proposals, then ask/,
      /better alternative beside it as a proposal/,
      /What the user explicitly asks for goes straight to ink/,
      /Only what you add on your own initiative is a proposal/,
      /Alternatives only when the right pick depends on something only the user knows/,
      /at most 2 side by side/,
      /call them A and B/,
      /Unanswered proposals stay/,
      /When 3 or more proposals are open \(two alternatives count as one\)/,
      /"Keep these\?"/,
      /Yes, ok, approve or similar: accept/,
      /No or reject: reject it/,
      /A or B: accept that alternative/,
      /After a reject you may ask again in other words, offer one other option as a new proposal, or move on/,
      /say the change you suggest in the bubble and draw nothing\. If the user agrees, change the ink directly/,
      /accept and reject, then drawing ops \(each propose before the ops that carry its id\)/,
    ])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
  });

  it("explains clicks: already applied, never re-sent, acknowledged briefly", () => {
    for (const rule of [
      /USER CLICKS SINCE LAST TURN when the user clicked \(rule 16\)/,
      /^16\. Clicks\./m,
      /"accept P3", "reject P4"; choosing one of two alternatives is an accept/,
      /They are already applied: CURRENT BOARD shows the result\. Never send accept or reject for them\./,
      /Acknowledge them in a few words in the say/,
    ])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
  });

  it("its example draws the React webpage as a proposal, inks it on yes, and draws what the user asks in ink", () => {
    const example = ARCHITECT_SYSTEM_PROMPT.slice(ARCHITECT_SYSTEM_PROMPT.indexOf("Examples."));
    expect(example).toMatch(/Let's build a React webpage\.[\s\S]*propose\{id:"P1"[\s\S]*proposal:"P1"[\s\S]*say\{/);
    expect(example).toMatch(/USER MESSAGE: "yes, and it calls an API"\nCalls: accept\{proposal:"P1"\}/);
    const asked = example.slice(example.indexOf("Add an SQS queue"));
    expect(asked).toContain('id:"jobs"');
    expect(asked).not.toContain("proposal");
  });

  it("follows the Well-Architected digest without quoting it, and offers a pillar review at the end", () => {
    for (const rule of [/never quote it/, /never paste its titles or any other AWS text/, /never cite best-practice IDs outside the pillar review/, /An end\. When nothing big is open/, /review against the six Well-Architected pillars/, /one gap per turn/, /plain words/])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/raise it again only in the pillar review/);
  });

  it("carries the whole digest inside the cached block, after the rules and catalogs", () => {
    expect(WELL_ARCHITECTED_DIGEST).toBe(renderWellArchitectedDigest());
    for (const catalogs of [[], ["aws"]]) {
      const [cached, language] = architectSystemPrompt({ catalogs, lang: "en-US" });
      expect(cached.cache).toBe(true);
      expect(cached.text.endsWith(`\n\n${WELL_ARCHITECTED_DIGEST}`)).toBe(true);
      expect(language.text).not.toContain("Well-Architected");
    }
    expect(WELL_ARCHITECTED_DIGEST).toContain("- REL10-BP01 ");
  });

  it("leaves the live prompt without the digest", () => {
    const live = systemPrompt({ catalogs: ["aws"], lang: "en-US" }).map((b) => b.text).join("\n");
    expect(live).not.toContain("Well-Architected");
    expect(live).not.toMatch(/[A-Z]+\d{2}-BP\d{2}/);
    expect(BOARD_SYSTEM_PROMPT).not.toContain(WELL_ARCHITECTED_DIGEST.slice(0, 40));
  });

  it("draws AWS groups only when they mean something", () => {
    for (const rule of [/add_group/, /set_parent/, /parent null/, /only when it means something/, /private network/, /more than one Availability Zone/, /serverless design stays flat/, /Security groups and Auto Scaling groups are never boxes/, /two components, one in each AZ group, joined by an arrow/, /Arrows join components only, never a group/])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
  });

  it("draws in the app-made system zone and never makes zones", () => {
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('zone "system"');
    expect(ARCHITECT_SYSTEM_PROMPT).not.toMatch(/create_zone/);
  });

  it("names AWS service ids only with the catalog on", () => {
    expect(architectSystemPrompt({ catalogs: [], lang: "en-US" })[0].text).not.toMatch(/set_service|Valid ids/);
    const [cached] = architectSystemPrompt({ catalogs: ["aws"], lang: "en-US" });
    expect(cached.text.startsWith(ARCHITECT_SYSTEM_PROMPT + "\n\n")).toBe(true);
    for (const s of AWS_SERVICES) expect(cached.text).toContain(s.id);
    expect(cached.text).toContain("set_service");
  });
});

describe("architect user text", () => {
  it("has the board, summary, the last 3 turns word for word and the message", () => {
    const recent = [1, 2, 3, 4].map((n) => ({ text: `ask ${n}`, bubble: n === 4 ? "" : `bubble ${n}` }));
    expect(buildArchitectUserText({ board: "ZONES\n- system", summary: "s", recent, text: "add an S3 bucket" })).toBe(
      "CURRENT BOARD:\nZONES\n- system\n\nSUMMARY SO FAR:\ns\n\nRECENT TURNS:\nUSER: ask 2\nYOUR BUBBLE: bubble 2\nUSER: ask 3\nYOUR BUBBLE: bubble 3\nUSER: ask 4\nYOUR BUBBLE: (none)\n\nUSER MESSAGE:\nadd an S3 bucket",
    );
  });
  it("lists the clicks since the last turn, in order, before the message; no section without clicks", () => {
    const actions = [{ type: "accept", proposal: "P3" }, { type: "reject", proposal: "P4" }] as const;
    expect(buildArchitectUserText({ board: "B", summary: "s", actions, text: "next" })).toBe(
      "CURRENT BOARD:\nB\n\nSUMMARY SO FAR:\ns\n\nRECENT TURNS:\n(none)\n\nUSER CLICKS SINCE LAST TURN:\n- accept P3\n- reject P4\n\nUSER MESSAGE:\nnext",
    );
    expect(buildArchitectUserText({ actions: [], text: "hi" })).not.toContain("CLICKS");
  });
  it("says so when there is nothing yet", () => {
    expect(buildArchitectUserText({ text: "hi" })).toBe("CURRENT BOARD:\n(empty board)\n\nSUMMARY SO FAR:\n(empty)\n\nRECENT TURNS:\n(none)\n\nUSER MESSAGE:\nhi");
  });
});
