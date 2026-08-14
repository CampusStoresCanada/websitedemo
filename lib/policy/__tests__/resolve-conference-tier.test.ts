import { describe, expect, it } from "vitest";
import { resolveConferenceTier } from "../engine";
import type { MembershipProgramDef } from "../types";

// Reproduces CSC's default program set (lib/policy/engine.ts's
// defaultMembershipPrograms), to verify resolveConferenceTier reproduces
// the exact 4-way behavior of the old, now-deleted duplicated
// orgTypeToTier() functions in conference-commerce.ts/conference-entities.ts.
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

describe("resolveConferenceTier — reproduces the old 4-way orgTypeToTier exactly", () => {
  it('"Member" → "member"', () => {
    expect(resolveConferenceTier("Member", CSC_PROGRAMS)).toBe("member");
  });

  it('"Vendor Partner" → "partner"', () => {
    expect(resolveConferenceTier("Vendor Partner", CSC_PROGRAMS)).toBe("partner");
  });

  it('"Non-Member" → "non_member" (conference-only classification, no permission program)', () => {
    expect(resolveConferenceTier("Non-Member", CSC_PROGRAMS)).toBe("non_member");
  });

  it('null → "public"', () => {
    expect(resolveConferenceTier(null, CSC_PROGRAMS)).toBe("public");
  });

  it('undefined → "public"', () => {
    expect(resolveConferenceTier(undefined, CSC_PROGRAMS)).toBe("public");
  });

  it('any other unrecognized type (e.g. "Staff", "Supplier") → "public"', () => {
    expect(resolveConferenceTier("Staff", CSC_PROGRAMS)).toBe("public");
    expect(resolveConferenceTier("Supplier", CSC_PROGRAMS)).toBe("public");
  });
});
