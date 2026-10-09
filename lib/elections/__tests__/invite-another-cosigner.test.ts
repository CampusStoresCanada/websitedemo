/**
 * Asking one more institution, after the nomination is already in.
 *
 * The invitation list was frozen at submission. Invite two, have one never
 * act, and the nomination was stuck with no way to ask anybody else — the
 * nominee could watch it fail and had nothing to press. Three people in the
 * 2027 cycle each invited exactly the two required, which built a closed
 * circle, and two of them stalled on a single unsigned request.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/elections/service.ts", "utf8");
const actions = readFileSync("lib/actions/elections.ts", "utf8");
const page = readFileSync("app/elections/accept/[token]/page.tsx", "utf8");

const invite = service.slice(
  service.indexOf("export async function inviteAdditionalCosigner"),
  service.indexOf("export async function chaseOutstandingCosignatures")
);

describe("who may ask", () => {
  it("is the nominee, or the committee on their behalf", () => {
    expect(invite).toContain("!input.isCommittee && row.nominee_profile_id !== input.actorProfileId");
    expect(actions).toContain("export async function inviteCosignerAction");
  });
});

describe("it adds a request, never a signature", () => {
  it("inserts unsigned", () => {
    expect(invite).toContain("sign_token: token");
    expect(invite).not.toContain("signed_at: new Date()");
  });

  it("emails every administrator there", () => {
    expect(invite).toContain('.eq("role", "org_admin")');
    expect(invite).toContain("notifyCosigners(");
  });
});

describe("every submission check still applies", () => {
  it("refuses a closed window", () => {
    expect(invite).toContain("if (!nominationsOpen(election))");
  });

  it("refuses an ineligible institution", () => {
    expect(invite).toContain("canOrganizationParticipate(election.id, input.organizationId)");
  });

  it("refuses one already asked", () => {
    expect(invite).toContain("That institution has already been asked.");
  });

  it("refuses the nominee's own store unless config allows it", () => {
    expect(invite).toContain("selfCosignatureAllowed");
    expect(invite).toContain("A nominee's own institution cannot co-sign their nomination.");
  });

  it("refuses a withdrawn or declined nomination", () => {
    expect(invite).toContain("row.withdrawn_at");
    expect(invite).toContain("row.candidate_declined_at");
  });

  it("says so when nobody there can be reached", () => {
    expect(invite).toContain("has no administrator with an account");
  });
});

describe("the control", () => {
  it("only appears while signatures are short", () => {
    expect(page).toContain("nomination.cosignatures.valid < nomination.cosignatures.required");
  });

  it("is withheld from an admin who is only looking", () => {
    expect(page).toContain("{canAct && askable.length > 0 && (");
  });

  it("excludes institutions already asked", () => {
    expect(page).toContain("const alreadyAsked = nomination.cosignatures.signingOrganizationIds");
  });
});
