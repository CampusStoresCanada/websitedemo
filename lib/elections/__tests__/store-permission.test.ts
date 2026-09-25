/**
 * Who may grant a nominee's institution permission to serve.
 *
 * By-Law Part V S2(d) requires the store to permit the nominee to serve. It
 * does NOT require a second person to be the one who says so — that refusal was
 * ours, and it made nominations impossible rather than merely awkward: 40 of
 * the 50 eligible institutions have exactly one administrator, usually the
 * store manager, who is the person most likely to stand. For them there was
 * nobody left to ask, and requiring someone else would have meant a subordinate
 * authorising their own manager.
 *
 * What survives is the institution boundary, and the record of who granted it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/elections/service.ts", "utf8");
const grant = service.slice(
  service.indexOf("export async function grantStorePermission"),
  service.indexOf("export async function", service.indexOf("export async function grantStorePermission") + 10)
);

describe("grantStorePermission", () => {
  it("still refuses anyone outside the nominee's institution", () => {
    expect(grant).toContain("!grantorOrganizationIds.includes(n.nominee_organization_id as string)");
    expect(grant).toContain("Only an administrator of the nominee's own institution");
  });

  it("no longer refuses the nominee themselves", () => {
    expect(grant).not.toContain("A nominee cannot grant their own institution");
    expect(grant).not.toContain("n.nominee_contact_id === grantedByContactId");
  });

  it("records WHO granted it, so a self-grant stays visible", () => {
    expect(grant).toContain("store_permission_granted_by_contact_id: grantedByContactId");
  });
});

describe("the committee can tell a self-grant apart", () => {
  it("exposes it on the nomination view", () => {
    expect(service).toContain("storePermissionSelfGranted");
    expect(service).toContain(
      "n.store_permission_granted_by_contact_id === n.nominee_contact_id"
    );
  });

  it("renders it on the cycle screen rather than only storing it", () => {
    const page = readFileSync("app/admin/elections/[slug]/page.tsx", "utf8");
    expect(page).toContain("n.storePermissionSelfGranted");
    expect(page).toContain("granted by the nominee");
  });
});

describe("the nominee's page offers the grant", () => {
  it("does not exclude the nominee from the control", () => {
    const page = readFileSync("app/elections/accept/[token]/page.tsx", "utf8");
    const gate = page.slice(
      page.indexOf("const canGrantStorePermission"),
      page.indexOf(";", page.indexOf("const canGrantStorePermission"))
    );
    expect(gate).toContain("adminOrganizationIds.includes(nomination.nomineeOrganizationId)");
    expect(gate).not.toContain("!isNominee");
  });
});
