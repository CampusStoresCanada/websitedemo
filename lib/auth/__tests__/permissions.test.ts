import { describe, expect, it } from "vitest";
import { derivePermissionState } from "../permissions";
import type { UserOrganization } from "../types";
import type { MembershipProgramDef } from "@/lib/policy/types";

/**
 * Reproduces CSC's exact default program config (lib/policy/engine.ts's
 * defaultMembershipPrograms), including the preserved quirk that a Vendor
 * Partner org_admin does NOT get elevated org_admin permission.
 */
const CSC_PROGRAMS: MembershipProgramDef[] = [
  {
    key: "member",
    orgTypeValue: "Member",
    label: "Member",
    permissionLevel: "member",
    orgAdminElevates: true,
    conferenceTier: "member",
    invoiceType: "membership",
    billing: { mode: "metric_engine" },
  },
  {
    key: "partner",
    orgTypeValue: "Vendor Partner",
    label: "Vendor Partner",
    permissionLevel: "partner",
    orgAdminElevates: false,
    conferenceTier: "partner",
    invoiceType: "partnership",
    billing: { mode: "flat_rate", rateCents: 50000 },
  },
];

function org(
  type: string,
  role: UserOrganization["role"],
  opts?: { linkStatus?: UserOrganization["status"]; orgAccessStatus?: string | null }
): UserOrganization {
  return {
    id: "uo-1",
    user_id: "u-1",
    organization_id: "org-1",
    role,
    status: opts?.linkStatus ?? "active",
    created_at: "2026-01-01",
    organization: {
      id: "org-1",
      name: "Test Org",
      type,
      slug: "test-org",
      logo_url: null,
      is_cancoll_member: false,
      membership_status: (opts?.orgAccessStatus ?? "active") as UserOrganization["organization"]["membership_status"],
    },
  };
}

describe("derivePermissionState — reproduces pre-generalization behavior exactly", () => {
  it("super_admin globalRole always wins, regardless of orgs", () => {
    expect(derivePermissionState("super_admin", [], CSC_PROGRAMS)).toBe("super_admin");
    expect(
      derivePermissionState("super_admin", [org("Vendor Partner", "org_admin")], CSC_PROGRAMS)
    ).toBe("super_admin");
  });

  it("admin globalRole always wins, regardless of orgs", () => {
    expect(derivePermissionState("admin", [], CSC_PROGRAMS)).toBe("admin");
  });

  it("org_admin of a Member org → org_admin", () => {
    expect(
      derivePermissionState("user", [org("Member", "org_admin")], CSC_PROGRAMS)
    ).toBe("org_admin");
  });

  it("QUIRK: org_admin of a Vendor Partner org does NOT get org_admin — gets partner", () => {
    expect(
      derivePermissionState("user", [org("Vendor Partner", "org_admin")], CSC_PROGRAMS)
    ).toBe("partner");
  });

  it("non-admin member of a Member org → member", () => {
    expect(
      derivePermissionState("user", [org("Member", "member")], CSC_PROGRAMS)
    ).toBe("member");
  });

  it("non-admin member of a Vendor Partner org → partner", () => {
    expect(
      derivePermissionState("user", [org("Vendor Partner", "member")], CSC_PROGRAMS)
    ).toBe("partner");
  });

  it("no org memberships → public", () => {
    expect(derivePermissionState("user", [], CSC_PROGRAMS)).toBe("public");
  });

  it("org_admin of a Member org whose OWN access is locked (not active/grace/reactivated) → public", () => {
    expect(
      derivePermissionState(
        "user",
        [org("Member", "org_admin", { orgAccessStatus: "locked" })],
        CSC_PROGRAMS
      )
    ).toBe("public");
  });

  it("org_admin of a Member org whose access is in grace → still org_admin", () => {
    expect(
      derivePermissionState(
        "user",
        [org("Member", "org_admin", { orgAccessStatus: "grace" })],
        CSC_PROGRAMS
      )
    ).toBe("org_admin");
  });

  it("the user's OWN link to the org is inactive (status != active) → public, even if org type is Member org_admin", () => {
    expect(
      derivePermissionState(
        "user",
        [org("Member", "org_admin", { linkStatus: "removed" as UserOrganization["status"] })],
        CSC_PROGRAMS
      )
    ).toBe("public");
  });

  it("mixed: plain member of Member org + plain member of Vendor Partner org → member wins over partner", () => {
    const memberOrg = org("Member", "member");
    const partnerOrg = { ...org("Vendor Partner", "member"), organization_id: "org-2" };
    expect(
      derivePermissionState("user", [memberOrg, partnerOrg], CSC_PROGRAMS)
    ).toBe("member");
  });

  it("mixed: org_admin of Vendor Partner (non-elevating) + plain member of Member org → member", () => {
    const partnerAdminOrg = org("Vendor Partner", "org_admin");
    const memberOrg = { ...org("Member", "member"), organization_id: "org-2" };
    expect(
      derivePermissionState("user", [partnerAdminOrg, memberOrg], CSC_PROGRAMS)
    ).toBe("member");
  });

  it("unrecognized org type (no matching program) → public", () => {
    expect(
      derivePermissionState("user", [org("Non-Member", "member")], CSC_PROGRAMS)
    ).toBe("public");
  });
});
