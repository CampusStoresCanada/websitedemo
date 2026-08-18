/**
 * Phase 1 — see ~/.claude/plans/membership-terms-and-programs.md
 *
 * The load-bearing test here is "seed matches the hardcoded fallback".
 * Production runs on defaultMembershipPrograms() until programs.definitions is
 * seeded, so seeding a value that differs in ANY field silently changes
 * behaviour instead of merely relocating its source — and it would change it
 * for pricing, permissions, conference tier and the memberships mirror at once.
 */
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  PROGRAMS_DEFINITIONS_SCHEMA,
  validateProgramsSemantics,
} from "../programs-validation";
import { defaultMembershipPrograms } from "../engine";
import type { MembershipProgramDef } from "../types";

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(PROGRAMS_DEFINITIONS_SCHEMA as unknown as object);

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
    billing: { mode: "flat_rate", rateCents: 60000 },
  },
];

const ORG_TYPES = new Set(["Member", "Vendor Partner", "Non-Member"]);

describe("PROGRAMS_DEFINITIONS_SCHEMA", () => {
  it("accepts the CSC programs", () => {
    expect(validate(CSC_PROGRAMS)).toBe(true);
  });

  it("rejects an unknown permissionLevel", () => {
    const bad = [{ ...CSC_PROGRAMS[0], permissionLevel: "superuser" }];
    expect(validate(bad)).toBe(false);
  });

  it("rejects a missing required field", () => {
    const rest = { ...CSC_PROGRAMS[0] } as Partial<MembershipProgramDef>;
    delete rest.invoiceType;
    expect(validate([rest])).toBe(false);
  });

  it("rejects unknown properties, so typos can't sit unnoticed", () => {
    const bad = [{ ...CSC_PROGRAMS[0], congerenceTier: "member" }];
    expect(validate(bad)).toBe(false);
  });

  it("rejects flat_rate without rateCents", () => {
    const bad = [{ ...CSC_PROGRAMS[1], billing: { mode: "flat_rate" } }];
    expect(validate(bad)).toBe(false);
  });

  it("rejects metric_engine carrying a rate it will never use", () => {
    const bad = [
      { ...CSC_PROGRAMS[0], billing: { mode: "metric_engine", rateCents: 500 } },
    ];
    expect(validate(bad)).toBe(false);
  });

  it("rejects an empty program list", () => {
    expect(validate([])).toBe(false);
  });

  it("rejects a key that isn't a safe identifier", () => {
    const bad = [{ ...CSC_PROGRAMS[0], key: "Vendor Partner" }];
    expect(validate(bad)).toBe(false);
  });
});

describe("validateProgramsSemantics", () => {
  it("passes the CSC programs", () => {
    expect(validateProgramsSemantics(CSC_PROGRAMS, ORG_TYPES)).toEqual([]);
  });

  it("catches a duplicate program key", () => {
    const dupe = [CSC_PROGRAMS[0], { ...CSC_PROGRAMS[1], key: "member" }];
    const errs = validateProgramsSemantics(dupe, ORG_TYPES);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('duplicate program key "member"');
  });

  it("catches two programs claiming the same org type", () => {
    const dupe = [CSC_PROGRAMS[0], { ...CSC_PROGRAMS[1], orgTypeValue: "Member" }];
    const errs = validateProgramsSemantics(dupe, ORG_TYPES);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('duplicate orgTypeValue "Member"');
  });

  it("catches an orgTypeValue no organization has", () => {
    const dangling = [{ ...CSC_PROGRAMS[0], orgTypeValue: "Affiliate" }];
    const errs = validateProgramsSemantics(dangling, ORG_TYPES);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('references orgTypeValue "Affiliate"');
  });

  it("skips the dangling check when no org types are known", () => {
    const dangling = [{ ...CSC_PROGRAMS[0], orgTypeValue: "Affiliate" }];
    expect(validateProgramsSemantics(dangling, new Set())).toEqual([]);
  });

  it("scales past two programs", () => {
    const three: MembershipProgramDef[] = [
      ...CSC_PROGRAMS,
      {
        key: "affiliate",
        orgTypeValue: "Non-Member",
        label: "Affiliate",
        permissionLevel: "member",
        orgAdminElevates: false,
        conferenceTier: "non_member",
        invoiceType: "affiliate",
        billing: { mode: "flat_rate", rateCents: 15000 },
      },
    ];
    expect(validate(three)).toBe(true);
    expect(validateProgramsSemantics(three, ORG_TYPES)).toEqual([]);
  });
});

describe("the seeded value vs the hardcoded fallback", () => {
  // Production runs on defaultMembershipPrograms() until programs.definitions
  // is seeded. lib/actions/policy.ts seeds by CALLING this function rather than
  // copying its output, so these cannot drift — this pins what it produces, and
  // that it satisfies its own validation.
  const seeded = defaultMembershipPrograms(60000);

  it("produces exactly CSC's two current programs", () => {
    expect(seeded).toEqual(CSC_PROGRAMS);
  });

  it("passes the schema it will be stored under", () => {
    expect(validate(seeded)).toBe(true);
  });

  it("passes semantic validation against real org types", () => {
    expect(validateProgramsSemantics(seeded, ORG_TYPES)).toEqual([]);
  });

  it("carries the partnership rate through to the partner program", () => {
    const partner = defaultMembershipPrograms(75000).find((p) => p.key === "partner");
    expect(partner?.billing).toEqual({ mode: "flat_rate", rateCents: 75000 });
  });
});
