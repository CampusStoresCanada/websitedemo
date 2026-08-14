import { describe, expect, it } from "vitest";
import { personaForMembership, deriveGlobalPersona, orgTypeForPersona } from "../persona";
import type { MembershipProgramDef } from "@/lib/policy/types";

// Reproduces CSC's default program set (lib/policy/engine.ts's
// defaultMembershipPrograms) — verifies the new formula-based derivation
// reproduces the 4 persona strings the old, now-deleted 4 independent
// implementations produced.
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

describe("personaForMembership", () => {
  it("Member org_admin → org_admin_member", () => {
    expect(personaForMembership({ orgType: "Member", role: "org_admin" }, CSC_PROGRAMS)).toBe(
      "org_admin_member"
    );
  });

  it("Member plain member → member_member", () => {
    expect(personaForMembership({ orgType: "Member", role: "member" }, CSC_PROGRAMS)).toBe(
      "member_member"
    );
  });

  it("Vendor Partner org_admin → org_admin_partner", () => {
    expect(
      personaForMembership({ orgType: "Vendor Partner", role: "org_admin" }, CSC_PROGRAMS)
    ).toBe("org_admin_partner");
  });

  it("Vendor Partner plain member → member_partner", () => {
    expect(personaForMembership({ orgType: "Vendor Partner", role: "member" }, CSC_PROGRAMS)).toBe(
      "member_partner"
    );
  });

  it("unrecognized org type → null", () => {
    expect(personaForMembership({ orgType: "Staff", role: "org_admin" }, CSC_PROGRAMS)).toBeNull();
    expect(personaForMembership({ orgType: null, role: "member" }, CSC_PROGRAMS)).toBeNull();
  });
});

describe("deriveGlobalPersona — precedence matches the original 4 independent implementations", () => {
  it("single Member org_admin membership → org_admin_member", () => {
    expect(
      deriveGlobalPersona([{ orgType: "Member", role: "org_admin" }], CSC_PROGRAMS)
    ).toBe("org_admin_member");
  });

  it("no memberships → null", () => {
    expect(deriveGlobalPersona([], CSC_PROGRAMS)).toBeNull();
  });

  it("memberships in only unrecognized org types → null", () => {
    expect(
      deriveGlobalPersona([{ orgType: "Staff", role: "member" }], CSC_PROGRAMS)
    ).toBeNull();
  });

  it("org_admin_member beats org_admin_partner when both present", () => {
    expect(
      deriveGlobalPersona(
        [
          { orgType: "Vendor Partner", role: "org_admin" },
          { orgType: "Member", role: "org_admin" },
        ],
        CSC_PROGRAMS
      )
    ).toBe("org_admin_member");
  });

  it("org_admin_partner beats member_member when both present", () => {
    expect(
      deriveGlobalPersona(
        [
          { orgType: "Member", role: "member" },
          { orgType: "Vendor Partner", role: "org_admin" },
        ],
        CSC_PROGRAMS
      )
    ).toBe("org_admin_partner");
  });

  it("member_member beats member_partner when both present (plain member of both)", () => {
    expect(
      deriveGlobalPersona(
        [
          { orgType: "Vendor Partner", role: "member" },
          { orgType: "Member", role: "member" },
        ],
        CSC_PROGRAMS
      )
    ).toBe("member_member");
  });

  it("member_partner is the fallback when it's the only qualifying membership", () => {
    expect(
      deriveGlobalPersona([{ orgType: "Vendor Partner", role: "member" }], CSC_PROGRAMS)
    ).toBe("member_partner");
  });
});

describe("generalizes beyond CSC's 2 programs (Stage 2 — proves the mechanism, not just today's 4 values)", () => {
  // A hypothetical 3rd program, not part of any real config today — proves
  // persona derivation is a formula (computePersonaCandidate), not a
  // per-program hardcoded lookup table, before lib/onboarding/steps.ts's
  // PERSONAS is ever actually widened to include it.
  const THREE_PROGRAMS: MembershipProgramDef[] = [
    ...CSC_PROGRAMS,
    {
      key: "affiliate",
      orgTypeValue: "Affiliate",
      label: "Affiliate",
      permissionLevel: "member",
      orgAdminElevates: true,
      conferenceTier: "affiliate",
      invoiceType: "affiliate",
      billing: { mode: "flat_rate", rateCents: 10000 },
    },
  ];
  const WIDENED_PERSONAS = [
    "org_admin_member",
    "org_admin_partner",
    "org_admin_affiliate",
    "member_member",
    "member_partner",
    "member_affiliate",
  ] as const;

  it("an org_admin of the 3rd program resolves to a correctly-computed persona once PERSONAS includes it", () => {
    expect(
      personaForMembership(
        { orgType: "Affiliate", role: "org_admin" },
        THREE_PROGRAMS,
        WIDENED_PERSONAS
      )
    ).toBe("org_admin_affiliate");
  });

  it("the SAME 3rd-program membership resolves to null against today's real (unwidened) PERSONAS — no crash, graceful no-tour degradation", () => {
    expect(personaForMembership({ orgType: "Affiliate", role: "org_admin" }, THREE_PROGRAMS)).toBeNull();
  });

  it("deriveGlobalPersona precedence extends correctly to the 3rd program", () => {
    expect(
      deriveGlobalPersona(
        [
          { orgType: "Affiliate", role: "member" },
          { orgType: "Vendor Partner", role: "member" },
        ],
        THREE_PROGRAMS,
        WIDENED_PERSONAS
      )
    ).toBe("member_partner"); // still beats member_affiliate — precedence order preserved
  });
});

describe("orgTypeForPersona — reverse lookup for OnboardingGate's display logic", () => {
  it("org_admin_member → Member", () => {
    expect(orgTypeForPersona("org_admin_member", CSC_PROGRAMS)).toBe("Member");
  });
  it("member_member → Member", () => {
    expect(orgTypeForPersona("member_member", CSC_PROGRAMS)).toBe("Member");
  });
  it("org_admin_partner → Vendor Partner", () => {
    expect(orgTypeForPersona("org_admin_partner", CSC_PROGRAMS)).toBe("Vendor Partner");
  });
  it("member_partner → Vendor Partner", () => {
    expect(orgTypeForPersona("member_partner", CSC_PROGRAMS)).toBe("Vendor Partner");
  });
});
