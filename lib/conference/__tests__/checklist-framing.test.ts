import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The reminder body used to hardcode "for the 2027 CSC Conference".
 *
 * Correct for Booth Readiness, wrong for Directory Listing — which now also
 * reaches 52 member stores who are in the printed book because they are in the
 * network, not because they are exhibiting. A member store reading that they
 * have things to finish "for the conference" would reasonably ignore it.
 */
const source = readFileSync("lib/conference/checklist-engine.ts", "utf8");

describe("reminder framing", () => {
  it("no longer hardcodes the conference framing in the sent copy", () => {
    // The literal lives in renderFraming's purchaser branch only.
    const occurrences = source.split("CSC Conference</strong>").length - 1;
    expect(occurrences).toBe(1);
  });

  it("supplies intro_line and consent_note on every send", () => {
    // Missing variables render as empty string, so a checklist that forgot to
    // supply intro_line would silently send a sentence with a hole in it.
    expect(source).toContain("...framing,");
    expect(source).toContain("renderFraming(");
  });

  it("selects the publication title for the framing sentence", () => {
    expect(source).toMatch(/publication:publications\(title\)/);
  });

  it("mentions the per-person ask only for publication-scoped checklists", () => {
    // Booth Readiness must not tell an exhibitor their staff are being printed.
    const fn = source.slice(source.indexOf("function renderFraming"), source.indexOf("function renderOpenItemsHtml"));
    const purchaserBranch = fn.slice(fn.indexOf("if (!checklist.publication_id)"), fn.indexOf("// Date only"));
    expect(purchaserBranch).toContain('consent_note: ""');
    expect(fn).toContain("is being asked, for");
  });

  it("does not hand-roll timestamp parsing", () => {
    // The hand-rolled version shipped "goes to press on NaN undefined" to a
    // real inbox: it appended a Z to a timestamp that already carried "+00".
    expect(source).toContain("formatDayMonth(checklist.deadline_at)");
    expect(source).not.toContain('endsWith("Z")');
  });

  it("falls back to wording rather than printing a broken date", () => {
    expect(source).toContain('?? "the deadline"');
  });

  it("leaves no template variable inside a variable's value", () => {
    // renderTemplate substitutes in ONE pass, so {{org_name}} embedded in the
    // consent note rendered literally in the email that went out.
    const fn = source.slice(source.indexOf("function renderFraming"), source.indexOf("function renderOpenItemsHtml"));
    expect(fn).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe("consent is per person — the admin has no role in it at all", () => {
  const fn = source.slice(source.indexOf("function renderFraming"), source.indexOf("function renderOpenItemsHtml"));

  it("never asks the admin to act on anyone else's behalf", () => {
    // Two earlier versions failed here. The first told the admin to remove
    // anyone who did not want to appear; the second folded consent into what
    // they were approving. A fail-safe that lets an admin stand in for silence
    // is opt-OUT with a different label.
    expect(fn).not.toMatch(/taken off your listing page/);
    expect(fn).not.toMatch(/covers your organisation's own details/);
    expect(fn).not.toMatch(/remove (them|anyone)/i);
  });

  it("states that nobody prints without their own yes", () => {
    expect(fn).toContain("without their own yes");
  });

  it("tells the admin explicitly there is nothing for them to do", () => {
    expect(fn).toContain("nothing for you to do");
  });

  it("keeps the note out of Booth Readiness", () => {
    const purchaserBranch = fn.slice(fn.indexOf("if (!checklist.publication_id)"), fn.indexOf("// Date only"));
    expect(purchaserBranch).toContain('consent_note: ""');
  });
});

describe("one email per organisation, not one per checklist", () => {
  it("accumulates every due checklist for an org before sending", () => {
    // The old shape sent a separate digest per checklist, so a partner admin
    // with three armed checklists got three messages — each titled "a few
    // things still need your attention", each a slice of the same list.
    expect(source).toContain("pendingByOrg");
    expect(source).toContain("existing.sections.push");
  });

  it("creates a single campaign after the checklist loop, not inside it", () => {
    const loopEnd = source.indexOf("if (pendingByOrg.size === 0) return result;");
    const campaignAt = source.indexOf("const campaignResult = await createCampaign(");
    expect(loopEnd).toBeGreaterThan(0);
    expect(campaignAt).toBeGreaterThan(loopEnd);
  });

  it("uses neutral framing when several checklists are merged", () => {
    // Sections may mix a conference checklist with a directory one; asserting
    // "for the conference" over a member store's directory tasks is the
    // wrong-audience wording this framing exists to prevent.
    expect(source).toContain('"has a few things outstanding:"');
  });

  it("keeps a lone reminder's own specific framing", () => {
    expect(source).toContain("pending.sections[0].introLine");
  });

  it("carries the consent note once, however many checklists supply it", () => {
    expect(source).toContain("if (!existing.consentNote && framing.consent_note)");
  });

  it("logs every checklist that contributed, so none is re-sent", () => {
    // The log is per (checklist, checkpoint, org). Merging the EMAIL must not
    // merge the log, or the checklists that shared the message would fire again.
    expect(source).toContain("sentLog.push(...pending.log)");
  });
});

describe("people can track this without keeping the email", () => {
  it("points at BOTH lists an org admin holds", () => {
    // An org admin is also a person and has two separate to-do lists — the
    // company's (which is what the email is) and their own. Sending them to
    // one and letting them find the other is how the overlapping-messages
    // problem started.
    expect(source).toContain("your organisation's page");
    expect(source).toContain("your own conference page");
    expect(source).toContain("/me#conference_checklist");
    expect(source).toContain("/org/${org.slug}#conference_checklist");
  });

  it("escapes the org name in the pointer", () => {
    // "Cutter & Buck" is a real member of this association.
    expect(source).toContain("escapeHtml(org.name)");
  });

  it("says the email is not the system of record", () => {
    expect(source).toContain("You don't need to keep this email");
  });
});
