import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Agreements split by WHO owes them.
 *
 * On CSC 2027 the Exhibitor & Booth Agreement is accept_by "buyer" and four
 * others are "assignee". An org admin cannot accept a code of conduct for
 * their staff — `recordLegalAcceptance` records against the authenticated
 * user and rejects any other id — so presenting one merged list would offer a
 * button the action layer refuses.
 *
 * Source-level, like the other renderer guards: these are server components
 * and the mistake worth catching is structural.
 */
const loader = readFileSync("lib/conference/org-legal.ts", "utf8");
const view = readFileSync("components/org/OrgAgreements.tsx", "utf8");

describe("who accepts what", () => {
  it("routes assignee-only documents away from the admin's list", () => {
    expect(loader).toContain('if (acceptBy === "assignee")');
    expect(loader).toContain("theirsTitles.push(title)");
  });

  it("puts a 'both' document in BOTH lists", () => {
    // Terms & Conditions is accept_by "both": the company signs it and every
    // attendee signs it. Showing it in one place only hides half the duty.
    expect(loader).toContain('if (acceptBy === "both") theirsTitles.push(title)');
  });

  it("treats an unmanaged document as the company's, not nobody's", () => {
    // A doc with no policy entity fails safe to shown, matching
    // getRequiredLegalDocuments. Dropping it would silently skip an agreement.
    expect(loader).toContain("// buyer, both, or unmanaged");
  });

  it("respects policy targeting rather than showing every document", () => {
    expect(loader).toContain("requiredPolicyEntityIds");
    expect(loader).toContain("if (v.policy_entity_id && !required.has(v.policy_entity_id)) continue;");
  });
});

describe("the roster tells you who can actually act", () => {
  it("distinguishes 'no account yet' from 'outstanding'", () => {
    // Someone without an account cannot accept anything, so chasing them to
    // sign is the wrong nag — they need activating first.
    expect(loader).toContain("hasAccount");
    expect(view).toContain("Hasn&rsquo;t activated their account yet");
  });

  it("never offers the admin a button for someone else's document", () => {
    expect(view).toContain("You can&rsquo;t accept these for someone else");
    // The only accept call takes a version id and records for the signed-in
    // user — there is no user-id parameter to abuse.
    expect(view).toContain("acceptLegalDocument(doc.versionId)");
    expect(view).not.toMatch(/recordLegalAcceptance\(/);
  });
});
