import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, raiseAlertMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  raiseAlertMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("../../ops/alerts", () => ({ raiseAlertIfNotOpen: raiseAlertMock }));
vi.mock("../../policy/engine", () => ({
  getRenewalConfig: vi.fn(async () => ({ cycle_start_month_day: "09-01", pre_renewal_skip_stub_days: 90 })),
}));
vi.mock("../../membership/renewal-activation", async () => {
  // The real helper is pure; only its module's side-effect imports need fencing.
  return {
    nextCycleStartOnOrAfter: (date: Date, md: string) => {
      const [m, d] = md.split("-").map(Number);
      const y = date.getUTCFullYear();
      const c = Date.UTC(y, m - 1, d);
      const day = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
      return new Date(c >= day ? c : Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
    },
    isWithinPreRenewalSkipWindow: (today: Date, md: string, days: number) => {
      const [m, d] = md.split("-").map(Number);
      const y = today.getUTCFullYear();
      const day = Date.UTC(y, today.getUTCMonth(), today.getUTCDate());
      const c = Date.UTC(y, m - 1, d) >= day ? Date.UTC(y, m - 1, d) : Date.UTC(y + 1, m - 1, d);
      return Math.round((c - today.getTime()) / 864e5) <= days;
    },
  };
});

import { createSponsorAgreementFromSponsorshipPurchase, sponsorshipTermEnd } from "../sponsorship-agreement";
import { provisionAgreementPlacements } from "../provision";

/**
 * A sponsorship sold as its own item (Kivuto, 2026-11: $2,000, Meet & Greet
 * naming plus year-round presence) becomes the sponsor's agreement the moment
 * it is paid: live, for the membership year, with the item's benefits copied.
 */

type Row = Record<string, unknown>;

/** A small in-memory db: enough of supabase-js for these two modules. */
function fakeDb(seed: { tiers?: Row[]; agreements?: Row[]; slots?: Row[]; orgs?: Row[]; placements?: Row[] }) {
  const tables: Record<string, Row[]> = {
    sponsor_tiers: seed.tiers ?? [],
    sponsor_agreements: seed.agreements ?? [],
    sponsor_placement_slots: seed.slots ?? [],
    organizations: seed.orgs ?? [],
    sponsor_placements: seed.placements ?? [],
  };
  const from = (table: string) => {
    let rows = tables[table];
    let inserted: Row[] | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      like: (c: string, pat: string) => {
        const needle = pat.replaceAll("%", "");
        rows = rows.filter((r) => String(r[c] ?? "").includes(needle));
        return q;
      },
      insert: (data: Row | Row[]) => {
        const list = (Array.isArray(data) ? data : [data]).map((r, i) => ({ id: `${table}-new-${tables[table].length + i}`, ...r }));
        tables[table].push(...list);
        inserted = list;
        return q;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: (inserted ?? rows)[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: inserted ?? rows, error: null }),
    });
    return q;
  };
  return { tables, db: { from } };
}

const SLOTS = [
  { id: "slot-sponsors", key: "sponsors_page", is_active: true },
  { id: "slot-partners", key: "logo_partners_page", is_active: true },
  { id: "slot-offsite", key: "conference_offsite", is_active: true },
  { id: "slot-email-h", key: "email_header", is_active: true },
  { id: "slot-email-f", key: "email_footer", is_active: true },
];
const ORG = { id: "kivuto", logo_url: "https://logo", website: "https://kivuto.com" };
const KIVUTO_BENEFITS = [
  { key: "conference_offsite_host", label: "Meet & Greet", config: { reference_id: "meet-greet" } },
  { key: "sponsors_page", label: "Sponsors page", config: {} },
  { key: "email_brand_presence", label: "Email", config: {} },
  { key: "circle_sponsored_post", label: "Circle post", config: { count: 4, cadence: "quarter" } },
  { key: "member_market_report", label: "Market report", config: {} },
];

beforeEach(() => vi.clearAllMocks());

describe("sponsorshipTermEnd", () => {
  it("runs to the end of the membership year by default", () => {
    expect(sponsorshipTermEnd("2026-11-12", "09-01")).toBe("2027-08-31");
  });
  it("bought on the cycle start, runs the year ahead, not zero days", () => {
    expect(sponsorshipTermEnd("2026-09-01", "09-01")).toBe("2027-08-31");
  });
  it("bought inside the pre-renewal window, runs the year ahead, not a day", () => {
    expect(sponsorshipTermEnd("2026-08-31", "09-01", null, 90)).toBe("2027-08-31");
    expect(sponsorshipTermEnd("2026-07-01", "09-01", null, 90)).toBe("2027-08-31");
  });
  it("bought before the window, runs to this year's end", () => {
    expect(sponsorshipTermEnd("2026-05-01", "09-01", null, 90)).toBe("2026-08-31");
  });
  it("takes an item's own term in months instead", () => {
    expect(sponsorshipTermEnd("2026-11-12", "09-01", 12)).toBe("2027-11-11");
  });
});

describe("createSponsorAgreementFromSponsorshipPurchase", () => {
  const call = () =>
    createSponsorAgreementFromSponsorshipPurchase({
      organizationId: "kivuto",
      orderId: "order-1",
      sponsorshipEntityId: "item-kivuto",
      sponsorshipName: "2027 Sponsorship — Kivuto",
      attributes: { benefits: KIVUTO_BENEFITS },
      startDate: "2026-11-12",
    });

  it("creates the agreement live, for the membership year, with the item's benefits copied", async () => {
    const { db, tables } = fakeDb({ tiers: [{ id: "tier-custom", slug: "custom", benefits: [] }], slots: SLOTS, orgs: [ORG] });
    createAdminClientMock.mockReturnValue(db);

    await call();

    expect(tables.sponsor_agreements).toHaveLength(1);
    expect(tables.sponsor_agreements[0]).toMatchObject({
      organization_id: "kivuto",
      tier_id: "tier-custom",
      status: "active",
      start_date: "2026-11-12",
      end_date: "2027-08-31",
      custom_benefits: KIVUTO_BENEFITS,
    });
  });

  it("puts up the placements its benefits fill, straight away", async () => {
    const { db, tables } = fakeDb({ tiers: [{ id: "tier-custom", slug: "custom", benefits: [] }], slots: SLOTS, orgs: [ORG] });
    createAdminClientMock.mockReturnValue(db);

    await call();

    const slots = tables.sponsor_placements.map((p) => p.slot_id).sort();
    // Sponsors page, the Meet & Greet, and both email slots. The Circle post
    // and the report are deliverables, not placements.
    expect(slots).toEqual(["slot-email-f", "slot-email-h", "slot-offsite", "slot-sponsors"]);
    const offsite = tables.sponsor_placements.find((p) => p.slot_id === "slot-offsite");
    expect(offsite).toMatchObject({ config_json: { reference_id: "meet-greet" }, logo_url: "https://logo" });
  });

  it("does nothing new on a webhook retry", async () => {
    const { db, tables } = fakeDb({ tiers: [{ id: "tier-custom", slug: "custom", benefits: [] }], slots: SLOTS, orgs: [ORG] });
    createAdminClientMock.mockReturnValue(db);

    await call();
    await call();

    expect(tables.sponsor_agreements).toHaveLength(1);
    expect(tables.sponsor_placements).toHaveLength(4);
  });

  it("raises it for a person, never silently, when the tier is missing", async () => {
    const { db, tables } = fakeDb({ slots: SLOTS, orgs: [ORG] });
    createAdminClientMock.mockReturnValue(db);

    await call();

    expect(tables.sponsor_agreements).toHaveLength(0);
    expect(raiseAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical", ruleKey: "sponsorship_agreement_missing_tier:order-1" })
    );
  });
});

describe("provisionAgreementPlacements", () => {
  it("reads the tier's benefits AND the agreement's own, which activation used to ignore", async () => {
    const { db, tables } = fakeDb({
      tiers: [{ id: "tier-connected", benefits: [{ key: "logo_partners_page", label: "Partners", config: {} }] }],
      agreements: [{ id: "agr", tier_id: "tier-connected", organization_id: "kivuto", custom_benefits: [{ key: "sponsors_page", label: "S", config: {} }] }],
      slots: SLOTS,
      orgs: [ORG],
    });

    const created = await provisionAgreementPlacements(db, "agr");

    expect(created).toBe(2);
    expect(tables.sponsor_placements.map((p) => p.slot_id).sort()).toEqual(["slot-partners", "slot-sponsors"]);
  });

  it("leaves a slot it already fills alone, so an admin's edits survive", async () => {
    const { db, tables } = fakeDb({
      tiers: [{ id: "t", benefits: [{ key: "sponsors_page", label: "S", config: {} }] }],
      agreements: [{ id: "agr", tier_id: "t", organization_id: "kivuto", custom_benefits: [] }],
      slots: SLOTS,
      orgs: [ORG],
      placements: [{ id: "p1", agreement_id: "agr", slot_id: "slot-sponsors", logo_url: "edited" }],
    });

    expect(await provisionAgreementPlacements(db, "agr")).toBe(0);
    expect(tables.sponsor_placements).toHaveLength(1);
  });
});
