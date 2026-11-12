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

import {
  membershipQuarterFor,
  parseSponsorPostMarker,
  sponsorPostDueDate,
  sponsorPostMarker,
  sponsorPostReminderEmail,
  syncSponsorPostActionItems,
} from "../post-reminders";

describe("membership-year quarters", () => {
  it.each([
    ["2026-09-01", "2026-09-01", "2026-11-30"],
    ["2026-11-30", "2026-09-01", "2026-11-30"],
    ["2026-12-01", "2026-12-01", "2027-02-28"],
    ["2027-01-15", "2026-12-01", "2027-02-28"],
    ["2028-02-29", "2027-12-01", "2028-02-29"],
    ["2027-03-01", "2027-03-01", "2027-05-31"],
    ["2027-08-31", "2027-06-01", "2027-08-31"],
  ])("%s falls in %s to %s", (date, start, end) => {
    const q = membershipQuarterFor(date, "09-01");
    expect([q.start, q.end]).toEqual([start, end]);
  });

  it("labels across a year boundary", () => {
    expect(membershipQuarterFor("2027-01-15", "09-01").label).toBe("Dec 2026 – Feb 2027");
  });

  it("is due 30 days before the quarter ends, never in the past", () => {
    const q = membershipQuarterFor("2027-01-15", "09-01");
    expect(sponsorPostDueDate(q, "2027-01-02")).toBe("2027-01-29");
    expect(sponsorPostDueDate(q, "2027-02-10")).toBe("2027-02-28");
  });

  it("round-trips its marker", () => {
    const id = "f3588b1e-fad3-4ce4-aa27-dd4026190a2a";
    expect(parseSponsorPostMarker(sponsorPostMarker(id, "2026-12-01"))).toEqual({ agreementId: id, quarterStart: "2026-12-01" });
    expect(parseSponsorPostMarker("something else")).toBeNull();
  });

  it("writes the sponsor email to them, without dashes", () => {
    const e = sponsorPostReminderEmail({ orgName: "Kivuto", quarter: membershipQuarterFor("2027-01-15", "09-01") });
    expect(e.subject).toBe("Your sponsored Circle post for Dec 2026 to Feb 2027");
    expect(e.html).toContain("Your CSC sponsorship");
    expect(e.html).toContain("February 28, 2027");
    expect(e.subject + e.html).not.toMatch(/[–—]/);
  });
});

type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { board_action_items: [], ...seed };
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let inserted: Row | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), q),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q),
      like: (c: string, pat: string) => ((rows = rows.filter((r) => String(r[c] ?? "").startsWith(pat.replace(/%$/, "")))), q),
      order: (c: string, o?: { ascending?: boolean }) => (
        (rows = [...rows].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1))), q
      ),
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      insert: (r: Row) => {
        inserted = { id: `new-${tables[table].length}`, ...r };
        tables[table].push(inserted);
        return q;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: inserted ?? rows, error: null }),
    });
    return q;
  };
  return { tables, db: { from } };
}

const AG = "f3588b1e-fad3-4ce4-aa27-dd4026190a2a";
function seed(over: Partial<Row> = {}, extra: Record<string, Row[]> = {}) {
  return fakeDb({
    sponsor_agreements: [
      {
        id: AG, organization_id: "org-k", status: "active", start_date: "2027-01-05", end_date: "2027-08-31",
        custom_benefits: [{ key: "circle_sponsored_post", label: "Circle post", config: { count: 2, cadence: "quarter" } }],
        tier: { benefits: [] }, organization: { name: "Kivuto" }, ...over,
      },
    ],
    board_meetings: [
      { id: "m-past", status: "upcoming", meeting_date: "2026-12-17" },
      { id: "m-jan", status: "upcoming", meeting_date: "2027-01-21" },
      { id: "m-mar", status: "upcoming", meeting_date: "2027-03-25" },
      { id: "m-jun", status: "upcoming", meeting_date: "2027-06-24" },
    ],
    app_settings: [{ key: "sponsorship_post_assignees", value: '["p-steve"]' }],
    ...extra,
  });
}

describe("syncSponsorPostActionItems", () => {
  beforeEach(() => raiseAlertMock.mockReset());

  it("puts this quarter's post on the next meeting, assigned and due a month out", async () => {
    const { tables, db } = seed();
    createAdminClientMock.mockReturnValue(db);
    expect(await syncSponsorPostActionItems("2027-01-06")).toEqual({ created: 1, skipped: 0 });
    const item = tables.board_action_items[0];
    expect(item).toMatchObject({
      meeting_id: "m-jan",
      title: "Sponsored Circle post: Kivuto (Dec 2026 – Feb 2027)",
      assignees: ["p-steve"],
      due_date: "2027-01-29",
      source: "sponsorship",
      source_excerpt: sponsorPostMarker(AG, "2026-12-01"),
    });
    expect(String(item.description)).toContain("(1 of 2)");
  });

  it("is re-runnable: one item per quarter", async () => {
    const { tables, db } = seed();
    createAdminClientMock.mockReturnValue(db);
    await syncSponsorPostActionItems("2027-01-06");
    expect(await syncSponsorPostActionItems("2027-01-07")).toEqual({ created: 0, skipped: 1 });
    expect(tables.board_action_items).toHaveLength(1);
  });

  it("mints the next quarter even if last quarter's is still open, up to the count", async () => {
    const { tables, db } = seed();
    createAdminClientMock.mockReturnValue(db);
    await syncSponsorPostActionItems("2027-01-06");
    await syncSponsorPostActionItems("2027-03-02");
    expect(tables.board_action_items).toHaveLength(2);
    await syncSponsorPostActionItems("2027-06-02");
    expect(tables.board_action_items).toHaveLength(2); // count 2 used up
  });

  it("does nothing for a sponsor not owed posts", async () => {
    const { tables, db } = seed({ custom_benefits: [{ key: "logo_partners_page", label: "Logo", config: {} }] });
    createAdminClientMock.mockReturnValue(db);
    await syncSponsorPostActionItems("2027-01-06");
    expect(tables.board_action_items).toHaveLength(0);
  });

  it("never invents a meeting", async () => {
    const { tables, db } = seed({}, { board_meetings: [] });
    createAdminClientMock.mockReturnValue(db);
    await syncSponsorPostActionItems("2027-01-06");
    expect(tables.board_action_items).toHaveLength(0);
    expect(raiseAlertMock).toHaveBeenCalledWith(expect.objectContaining({ ruleKey: "sponsor_post_no_meeting:2026-12-01" }));
  });
});
