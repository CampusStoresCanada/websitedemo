/**
 * Who gets told that their institution has been asked to co-sign.
 *
 * It used to be one administrator, chosen by `.limit(1)` with no ORDER BY —
 * so at a store with two admins the request went to whichever row came back
 * first. University of Calgary has two. The nomination then waited on one
 * arbitrary person happening to read one email, and nothing ever chased them.
 *
 * The signature belongs to the INSTITUTION and any of its active staff may
 * give it, so there was never a reason to address only one person.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/elections/service.ts", "utf8");
const notify = readFileSync("lib/elections/notify.ts", "utf8");

const submit = service.slice(
  service.indexOf("export async function submitMemberNomination"),
  service.indexOf("export async function notifyIfNowComplete")
);

describe("every administrator is asked", () => {
  it("no longer takes the first row it happens to get", () => {
    expect(submit).not.toContain('.eq("role", "org_admin")\n      .eq("status", "active")\n      .limit(1)');
    expect(submit).toContain("const inviteTargets: { organizationId: string; contactIds: string[] }[]");
  });

  it("orders the contacts, so the recorded addressee is stable", () => {
    expect(submit).toContain(".sort()");
  });

  it("fans the invitation out to all of them on one token", () => {
    const build = notify.slice(notify.indexOf("export async function buildCosigners"));
    expect(build).toContain("contactIds: string[]");
    expect(build).toContain("recipients: resolved.flatMap(");
    expect(build).toContain("contacts.map((contact)");
  });
});

describe("an institution nobody can be reached at", () => {
  it("is reported rather than skipped in silence", () => {
    expect(submit).toContain("uncontactable");
    expect(submit).toContain("has no administrator with an account");
  });

  it("does not fail the nomination, which is already recorded", () => {
    // It lands in notifications.problems, alongside send failures.
    expect(submit).toContain("notifications.problems.push");
  });
});

describe("what the signature is attributed to", () => {
  it("still records a signer, since the column cannot be null", () => {
    expect(service).toContain("contact_id: c.contactIds[0]");
  });

  it("is given by the institution, not by the addressee", () => {
    const sign = service.slice(service.indexOf("export async function signCosignature"));
    expect(sign).toContain("!signer.organizationIds.includes(sig.organization_id as string)");
    expect(sign).not.toContain("signer.contactId !== sig.contact_id");
  });
});
