// Nobody clicks a screen they never think to open.
//
// Helpful Ghost drafts a welcome post the night a partner activates, and the
// publisher only ever picks up rows at `approved`. An unapproved draft is not
// late, it is STOPPED — and nothing escalates on its own. Measured 2026-09-21:
// three drafts waiting, the oldest for eighteen days, while the partner it
// welcomed had been a member for most of a month.
//
// A welcome that arrives two months after somebody joined is worse than none,
// so this rule is about the post going stale, not about a job failing.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; organization_id: string; title: string; created_at: string };

let ROWS: Row[] = [];
let askedFor: { kind?: unknown; status?: unknown; ltColumn?: string; ltValue?: string } = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          if (col === "kind") askedFor.kind = val;
          if (col === "status") askedFor.status = val;
          return chain;
        },
        lt: (col: string, val: string) => {
          askedFor.ltColumn = col;
          askedFor.ltValue = val;
          return chain;
        },
        order: async () => ({
          data: ROWS.filter((r) => !askedFor.ltValue || r.created_at < askedFor.ltValue),
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const { evaluateNewPartnerAnnouncementsWaiting } = await import("../alerts");

describe("the unapproved new partner announcement nag", () => {
  beforeEach(() => {
    ROWS = [];
    askedFor = {};
  });

  it("stays quiet when nothing has been waiting past the grace period", async () => {
    ROWS = [{ id: "a", organization_id: "o", title: "Welcome, Fresh Co", created_at: daysAgo(2) }];
    const found = await runRule();
    expect(found).toBeNull();
  });

  it("fires once a draft has sat longer than the grace period", async () => {
    ROWS = [{ id: "a", organization_id: "o", title: "Welcome, Slow Co", created_at: daysAgo(18) }];
    const found = await runRule();
    expect(found?.ruleKey).toBe("new_partner_announcement_unapproved");
  });

  it("asks only for DRAFTS — an approved row is the human's part already done", async () => {
    ROWS = [{ id: "a", organization_id: "o", title: "Welcome, Slow Co", created_at: daysAgo(18) }];
    await runRule();
    expect(askedFor.status).toBe("draft");
    expect(askedFor.kind).toBe("new_partner");
  });

  it("keeps counts and names OUT of the message, because an open alert freezes it", async () => {
    // "3 waiting" would still say 3 when a fourth partner joined. The numbers
    // go in details; the review screen is the source of truth.
    ROWS = [
      { id: "a", organization_id: "o1", title: "Welcome, One", created_at: daysAgo(18) },
      { id: "b", organization_id: "o2", title: "Welcome, Two", created_at: daysAgo(12) },
    ];
    const found = await runRule();
    expect(found?.message).not.toMatch(/\d/);
    expect(found?.details).toMatchObject({ countAtDetection: 2 });
  });

  it("points at the screen, since the whole failure is nobody opening it", async () => {
    ROWS = [{ id: "a", organization_id: "o", title: "Welcome, Slow Co", created_at: daysAgo(18) }];
    const found = await runRule();
    expect(found?.message).toContain("New Partners");
    expect(found?.details).toMatchObject({ reviewPath: "/admin/comms/announcements" });
  });

  async function runRule() {
    return evaluateNewPartnerAnnouncementsWaiting();
  }
});
