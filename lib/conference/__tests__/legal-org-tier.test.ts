import { describe, expect, it } from "vitest";
import { resolveConferenceTier } from "@/lib/policy/engine";

/**
 * Regression guard for a bug that shipped silently: computeOrgLegalCompleteness
 * compared `organizations.type` against the snake_case literal
 * "vendor_partner". The column is human-readable and capitalised, so the
 * comparison never matched and EVERY vendor partner was evaluated against
 * member-targeted policies — asked to accept the Member Code of Conduct rather
 * than the Vendor Code of Conduct, and never asked for partner-only documents.
 *
 * Nothing failed loudly: the wrong document set is still a valid document set.
 */
const PROGRAMS = [
  { key: "member", orgTypeValue: "Member", label: "Member", permissionLevel: "member",
    orgAdminElevates: true, conferenceTier: "member", invoiceType: "membership",
    billing: { mode: "metric_engine" as const } },
  { key: "partner", orgTypeValue: "Vendor Partner", label: "Vendor Partner", permissionLevel: "partner",
    orgAdminElevates: false, conferenceTier: "partner", invoiceType: "partnership",
    billing: { mode: "flat_rate" as const, rateCents: 0 } },
];

describe("org type → conference tier", () => {
  it("maps the real, capitalised column values", () => {
    expect(resolveConferenceTier("Vendor Partner", PROGRAMS)).toBe("partner");
    expect(resolveConferenceTier("Member", PROGRAMS)).toBe("member");
  });

  it("does not match snake_case — the shape of the original bug", () => {
    // If this ever returns "partner", someone has reintroduced a lowercase
    // literal somewhere and the guard above stops being meaningful.
    expect(resolveConferenceTier("vendor_partner", PROGRAMS)).not.toBe("partner");
  });

  it("gives non-members and unknown types their own tier, not member by default", () => {
    // The old ternary's else-branch swept every non-partner into "member",
    // including Non-Member, Staff and Supplier orgs.
    expect(resolveConferenceTier("Non-Member", PROGRAMS)).toBe("non_member");
    expect(resolveConferenceTier("Supplier", PROGRAMS)).toBe("public");
    expect(resolveConferenceTier(null, PROGRAMS)).toBe("public");
  });
});
