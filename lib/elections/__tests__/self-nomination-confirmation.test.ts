/**
 * What a self-nominee is told at the moment of submitting.
 *
 * The confirmation was written for nominating somebody else and said two
 * things that were false about a self-nomination: that the nominator's
 * institution had signed it — a nominee cannot co-sign themselves, so their own
 * store does not count and they need two OTHER institutions — and that "the
 * nominee" and "their institution" still had to act, when both are the reader.
 *
 * Someone read "Recorded. Your institution's signature is on it" and
 * reasonably stopped there. Acceptance is deliberately a second consent for
 * everyone (Part V S2(d)); the defect was never telling them so.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("app/elections/[slug]/nominate/page.tsx", "utf8");
const confirmation = page.slice(page.indexOf("if (submitted) {"), page.indexOf("// Step 2"));

describe("the confirmation reads the real nomination", () => {
  it("resolves it from the accept token rather than assuming", () => {
    expect(confirmation).toContain("getNominationByToken(submitted)");
  });

  it("decides self-nomination from the viewer's own contacts", () => {
    expect(confirmation).toContain("actorNow.contactIds.includes(");
  });
});

describe("a self-nominee is told the truth", () => {
  it("does not claim their institution has signed", () => {
    const selfBranch = confirmation.slice(
      confirmation.indexOf("{selfNominated ? ("),
      confirmation.indexOf("Nominate someone else")
    );
    expect(selfBranch).toContain("You have put your own name forward");
    expect(selfBranch).toContain("You cannot");
    expect(selfBranch).toContain("co-sign your own nomination");
  });

  it("names accepting as THEIR outstanding step, not somebody else's", () => {
    expect(confirmation).toContain("<strong>You accept.</strong>");
    expect(confirmation).toContain("two separate steps");
  });

  it("links them straight to the page where they accept", () => {
    expect(confirmation).toContain("`/elections/accept/${submitted}`");
    expect(confirmation).toContain("Accept and write your statement");
  });

  it("still tells someone nominating a colleague the original thing", () => {
    expect(confirmation).toContain("Your institution&apos;s signature is on it");
    expect(confirmation).toContain("<strong>The nominee accepts</strong>");
  });
});
