import { describe, expect, it } from "vitest";
import { applyOps, architectZoneOp, emptyBoard } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import {
  checkAlternatives, checkAsksKeep, checkBpIds, checkBubbleOnly, checkInk, checkOneQuestion, checkOneSay, checkPencil, checkReview,
  checkTurn, citedBpIds, pendingCount,
} from "./checks";

const say = (text: string): Op => op.say({ text });
const summary = op.update_summary({ text: "s" });
const comp = (id: string, proposal?: string, service?: string): Op =>
  op.add_component({ zone: "system", id, label: id, type: "service", ...(proposal ? { proposal } : {}), ...(service ? { service } : {}) });
const link = (id: string, from: string, to: string, proposal?: string): Op => op.connect({ id, from, to, ...(proposal ? { proposal } : {}) });
const propose = (id: string, alternative_to?: string): Op => op.propose({ id, label: id, ...(alternative_to ? { alternative_to } : {}) });
const group = (id: string, proposal?: string): Op => op.add_group({ id, kind: "vpc", label: id, ...(proposal ? { proposal } : {}) });

const boardWith = (ops: Op[]) => applyOps(emptyBoard(), [architectZoneOp("Architecture"), ...ops]).board;

describe("every turn", () => {
  it("has exactly one say", () => {
    expect(checkOneSay([comp("a"), say("Hi."), summary])).toEqual({ pass: true });
    expect(checkOneSay([comp("a"), summary])).toEqual({ pass: false, detail: "no say" });
    expect(checkOneSay([say("one"), say("two")])).toEqual({ pass: false, detail: "2 says" });
  });

  it("asks at most one question in the bubble (the last say)", () => {
    expect(checkOneQuestion([say("Drew it. Does it call an API?")])).toEqual({ pass: true });
    expect(checkOneQuestion([say("Done.")])).toEqual({ pass: true });
    expect(checkOneQuestion([say("¿Usa una API?")])).toEqual({ pass: true });
    expect(checkOneQuestion([say("Is it public? Who signs in?")])).toEqual({ pass: false, detail: "2 questions" });
    expect(checkOneQuestion([say("A? B?"), say("Fine.")])).toEqual({ pass: true });
    expect(checkOneQuestion([comp("a")])).toEqual({ pass: true });
  });

  it("opens at most two alternatives side by side, counting the open ones on the board", () => {
    expect(checkAlternatives([propose("P1"), propose("P2", "P1"), say("A or B?")])).toEqual({ pass: true });
    expect(checkAlternatives([propose("P1"), propose("P2", "P1"), propose("P3", "P2")])).toEqual({ pass: false, detail: "3 alternatives: P1, P2, P3" });
    expect(checkAlternatives([propose("P3", "P1")], [{ id: "P1", label: "x" }, { id: "P2", label: "y", alternativeTo: "P1" }])).toEqual({
      pass: false, detail: "3 alternatives: P1, P2, P3",
    });
    // Accepting P1 first closes it and its alternative, so the new pair stands alone.
    expect(checkAlternatives([op.accept({ proposal: "P1" }), propose("P3"), propose("P4", "P3")], [{ id: "P1", label: "x" }, { id: "P2", label: "y", alternativeTo: "P1" }])).toEqual({ pass: true });
    expect(checkAlternatives([op.reject({ proposal: "P2" }), propose("P3", "P1")], [{ id: "P1", label: "x" }, { id: "P2", label: "y", alternativeTo: "P1" }])).toEqual({ pass: true });
  });

  it("cites only best-practice ids that exist in the Well-Architected digest", () => {
    expect(citedBpIds([say("One database is a single point of failure (REL10-BP01)."), op.update_summary({ text: "Cited PERF02-BP01." })])).toEqual(["REL10-BP01", "PERF02-BP01"]);
    expect(checkBpIds([say("No review yet.")])).toEqual({ pass: true });
    expect(checkBpIds([say("Spread it over AZs (REL10-BP01).")])).toEqual({ pass: true });
    expect(checkBpIds([say("Encrypt it (SEC99-BP42), and (REL10-BP01).")])).toEqual({ pass: false, detail: "not in the digest: SEC99-BP42" });
  });
});

describe("only when expect names it", () => {
  it("ink: something is drawn in ink, and Claude's own additions may be pencil beside it", () => {
    expect(checkInk([comp("api"), link("c1", "api", "db"), say("Done."), summary])).toEqual({ pass: true });
    expect(checkInk([comp("q"), propose("P1"), comp("ses", "P1"), link("c1", "q", "ses", "P1"), say("Penciled in SES.")])).toEqual({ pass: true });
    expect(checkInk([say("Done.")])).toEqual({ pass: false, detail: "nothing drawn" });
    expect(checkInk([propose("P1"), comp("api", "P1"), say("ok")])).toEqual({ pass: false, detail: "nothing drawn in ink" });
  });

  it("ink: each asked service is on an ink component, once per time it is asked", () => {
    const ops = [comp("q", undefined, "sqs"), comp("mailer", undefined, "aws:lambda"), propose("P1"), comp("ses", "P1", "ses"), say("ok")];
    expect(checkInk(ops, ["sqs", "lambda"])).toEqual({ pass: true });
    expect(checkInk(ops, ["sqs", "ses"])).toEqual({ pass: false, detail: "not in ink: ses" });
    expect(checkInk(ops, ["lambda", "lambda"])).toEqual({ pass: false, detail: "not in ink: lambda" });
    // set_service on an ink component counts; on a pencil one it does not.
    expect(checkInk([comp("q"), comp("x", "P1"), op.set_service({ id: "q", service: "sqs" }), op.set_service({ id: "x", service: "ses" })], ["sqs", "ses"])).toEqual({
      pass: false, detail: "not in ink: ses",
    });
  });

  it("pencil: something is drawn and every drawing op carries a proposal", () => {
    expect(checkPencil([propose("P1"), comp("api", "P1"), group("vpc", "P1"), link("c1", "api", "db", "P1"), say("API?")])).toEqual({ pass: true });
    expect(checkPencil([say("What is it for?")])).toEqual({ pass: false, detail: "nothing drawn" });
    expect(checkPencil([propose("P1"), comp("api", "P1"), comp("db"), link("c1", "api", "db")])).toEqual({ pass: false, detail: "in ink: add_component db, connect c1" });
  });

  it("bubbleOnly: no op but say, and update_summary", () => {
    expect(checkBubbleOnly([say("I only design AWS architectures."), summary])).toEqual({ pass: true });
    expect(checkBubbleOnly([say("No."), comp("tf"), op.delete({ id: "x" })])).toEqual({ pass: false, detail: "also sent: add_component, delete" });
  });

  it("asksKeep: with 3+ pending before the turn, the bubble asks to keep them, in English or Spanish", () => {
    expect(checkAsksKeep([say("Keep these three?")], 3)).toEqual({ pass: true });
    expect(checkAsksKeep([say("Should I keep the CDN, the cache and the queue?")], 4)).toEqual({ pass: true });
    expect(checkAsksKeep([say("¿Mantengo estas tres?")], 3)).toEqual({ pass: true });
    expect(checkAsksKeep([say("¿Conservo las propuestas?")], 3)).toEqual({ pass: true });
    expect(checkAsksKeep([say("¿Me quedo con estas?")], 3)).toEqual({ pass: true });
    expect(checkAsksKeep([say("¿Las dejo?")], 3)).toEqual({ pass: true });
    expect(checkAsksKeep([say("How do users sign in?")], 3)).toEqual({ pass: false, detail: "3 pending, no keep question" });
    expect(checkAsksKeep([say("How do users sign in?")], 2)).toEqual({ pass: null, detail: "only 2 pending before the turn" });
  });

  it("review: the bubble cites a best-practice id", () => {
    expect(checkReview([say("One database is a single point of failure (REL10-BP01).")])).toEqual({ pass: true });
    expect(checkReview([say("Looks good.")])).toEqual({ pass: false, detail: "no best-practice id in the bubble" });
  });
});

describe("pendingCount", () => {
  it("counts open proposals, two alternatives as one", () => {
    expect(pendingCount(boardWith([]))).toBe(0);
    expect(pendingCount(boardWith([propose("P1"), propose("P2"), propose("P3", "P2"), propose("P4")]))).toBe(3);
  });
});

describe("checkTurn", () => {
  it("runs the every-turn checks always and the expect checks only when named", () => {
    const before = boardWith([propose("P1"), propose("P2"), propose("P3")]);
    const r = checkTurn([comp("api"), say("Keep these? (REL10-BP01)"), summary], { before, expect: ["ink", "asksKeep"] });
    expect(r).toEqual({
      oneSay: { pass: true }, oneQuestion: { pass: true }, alternatives: { pass: true }, bpIds: { pass: true },
      ink: { pass: true }, asksKeep: { pass: true },
    });
    expect(Object.keys(checkTurn([say("Hi.")], { before, expect: [] }))).toEqual(["oneSay", "oneQuestion", "alternatives", "bpIds"]);
  });
});
