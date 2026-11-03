import { describe, expect, it, vi } from "vitest";

/**
 * Dues are priced off the one FTE: `organizations.fte`, the number the org
 * page shows and a benchmarking submission refreshes.
 *
 * Pricing used to read a copy on `memberships.fte`, which only some writers
 * kept in step. Fanshawe (2026-10) submitted 15,035 in the survey; the org
 * page showed 15,035 and the copy still said 37,291 — a higher tier.
 */

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("../../supabase/admin", () => ({ createAdminClient }));
vi.mock("../../policy/engine", () => ({
  getProgramsConfig: vi.fn(async () => [{ key: "member", orgTypeValue: "Member" }]),
}));

import { computeMembershipAssessment } from "../pricing";

const TIERS = [
  { max_fte: 2500, price: 420 },
  { max_fte: 5000, price: 525 },
  { max_fte: 10000, price: 735 },
  { max_fte: 20000, price: 895 },
  { max_fte: null, price: 1000 },
];

function mockDb() {
  const tables: Record<string, { list: unknown; one: unknown }> = {
    organizations: { list: null, one: { id: "org-f", type: "Member", fte: 15035 } },
    memberships: { list: [{ organization_id: "org-f", program_key: "member", fte: 37291 }], one: null },
    benchmarking: { list: null, one: null },
    policy_values: {
      list: [
        { key: "billing.pricing_mode", value_json: "FTE_BUCKETS" },
        { key: "billing.membership_tiers", value_json: TIERS },
        { key: "billing.manual_override_allowed", value_json: false },
      ],
      one: null,
    },
  };
  return {
    from(table: string) {
      const r = tables[table] ?? { list: [], one: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit", "is"]) chain[m] = () => chain;
      chain.single = async () => ({ data: r.one, error: null });
      chain.maybeSingle = async () => ({ data: r.one, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: r.list, error: null });
      return chain;
    },
  };
}

describe("computeMembershipAssessment", () => {
  it("prices off organizations.fte, not the copy on memberships", async () => {
    createAdminClient.mockReturnValue(mockDb());

    const assessment = await computeMembershipAssessment("org-f", {
      persist: false,
      policySetId: "ps-1",
      billingCycleYear: 2027,
    });

    expect(assessment.metricValue).toBe(15035);
    expect(assessment.computedAmountCents).toBe(89500);
  });
});
