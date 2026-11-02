import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseDesignPrinciples,
  parsePublicationDate,
  parseQuestionPage,
  renderFrameworkModule,
} from "../scripts/fetch-wellarchitected";
import { FRAMEWORK } from "./framework.generated";

// Shaped like the markdown the AWS Knowledge MCP server returns for framework pages.
const QUESTION_PAGE = `# REL 10. How do you use fault isolation to protect your workload?

Fault isolated boundaries limit the effect of a failure.

###### Best practices

* REL10-BP01 Deploy the workload to multiple
  locations
* REL10-BP02 Automate recovery for components constrained to a single location
`;

describe("parseQuestionPage", () => {
  it("reads the question and its best practices, folding wrapped bullets", () => {
    expect(parseQuestionPage(QUESTION_PAGE, "REL", 10)).toEqual({
      id: "REL 10",
      title: "How do you use fault isolation to protect your workload?",
      bestPractices: [
        { id: "REL10-BP01", title: "Deploy the workload to multiple locations" },
        { id: "REL10-BP02", title: "Automate recovery for components constrained to a single location" },
      ],
    });
  });

  it("accepts a heading without the period after the number", () => {
    const md = "# SUS 1 How do you select Regions for your workload?\n\n###### Best practices\n\n* SUS01-BP01 Choose Region\n";
    expect(parseQuestionPage(md, "SUS", 1).title).toBe("How do you select Regions for your workload?");
  });

  it("refuses the wrong page or a best practice of another question", () => {
    expect(() => parseQuestionPage(QUESTION_PAGE, "REL", 11)).toThrow(/REL 11/);
    expect(() => parseQuestionPage("# AWS Well-Architected Framework\n", "REL", 1)).toThrow();
    const stray = QUESTION_PAGE.replace("REL10-BP02", "REL11-BP02");
    expect(() => parseQuestionPage(stray, "REL", 10)).toThrow(/REL11-BP02/);
  });
});

describe("parseDesignPrinciples", () => {
  it("takes the bold titles, with the colon inside or outside the bold", () => {
    const md = `# Design principles

There are two:

* **Test systems at production
  scale**: In the cloud, you can create a test environment.
* **Maintain traceability:** Monitor, alert, and audit.
`;
    expect(parseDesignPrinciples(md)).toEqual(["Test systems at production scale", "Maintain traceability"]);
  });
});

describe("parsePublicationDate", () => {
  it("reads the date on the welcome page", () => {
    expect(parsePublicationDate("# AWS Well-Architected Framework\n\nPublication date: **November 6, 2024** (Document revisions)")).toBe(
      "November 6, 2024",
    );
    expect(() => parsePublicationDate("# Welcome")).toThrow();
  });
});

describe("renderFrameworkModule", () => {
  it("reproduces the committed file byte for byte (it was not edited by hand)", () => {
    const committed = readFileSync(fileURLToPath(new URL("./framework.generated.ts", import.meta.url)), "utf8");
    expect(renderFrameworkModule(FRAMEWORK)).toBe(committed);
  });
});
