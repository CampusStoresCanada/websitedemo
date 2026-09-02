import { describe, it, expect } from "vitest";
import {
  refusalStanding,
  enforcedPairs,
  thawPrompts,
  type RefusalRow,
  type RefusalPolicy,
} from "../refusal-standing";

const NOW = new Date("2026-09-02T12:00:00Z");
const POLICY: RefusalPolicy = { lapseAfterDays: 1095, promptAfterDays: 365 };

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const row = (over: Partial<RefusalRow> = {}): RefusalRow => ({
  declaring_org_id: "member",
  refused_org_id: "vendor",
  declared_by_contact_id: "karin",
  first_declared_at: daysAgo(30),
  ...over,
});

describe("refusalStanding", () => {
  it("enforces a fresh refusal", () => {
    const s = refusalStanding(row(), NOW, POLICY);
    expect(s.enforced).toBe(true);
    expect(s.dueForThaw).toBe(false);
  });

  it("lets an old one lapse without anyone clearing it", () => {
    // ⛔ Persists-until-cleared is a trap: clearing old blackouts is nobody's
    // job, so it becomes permanent in practice.
    const s = refusalStanding(row({ first_declared_at: daysAgo(1200) }), NOW, POLICY);
    expect(s.enforced).toBe(false);
  });

  it("resets the clock when it is re-affirmed", () => {
    // Saying it still stands IS the signal that it still stands.
    const s = refusalStanding(
      row({ first_declared_at: daysAgo(1200), reaffirmed_at: daysAgo(10) }),
      NOW,
      POLICY
    );
    expect(s.enforced).toBe(true);
    expect(s.dueForThaw).toBe(false);
    expect(Math.round(s.ageDays)).toBe(10);
  });

  it("stops enforcing once a human retires it, however recent", () => {
    const s = refusalStanding(row({ retired_at: daysAgo(1) }), NOW, POLICY);
    expect(s.enforced).toBe(false);
    expect(s.retired).toBe(true);
  });

  it("flags one that is still in force but old enough to ask about", () => {
    const s = refusalStanding(row({ first_declared_at: daysAgo(400) }), NOW, POLICY);
    expect(s.enforced).toBe(true);
    expect(s.dueForThaw).toBe(true);
  });

  it("never asks about a refusal that has already lapsed", () => {
    // Nothing to discuss — it stopped mattering on its own.
    const s = refusalStanding(row({ first_declared_at: daysAgo(2000) }), NOW, POLICY);
    expect(s.dueForThaw).toBe(false);
  });

  it("treats a future timestamp as now rather than granting extra life", () => {
    const s = refusalStanding(row({ first_declared_at: daysAgo(-50) }), NOW, POLICY);
    expect(s.ageDays).toBe(0);
    expect(s.enforced).toBe(true);
  });
});

describe("enforcedPairs", () => {
  it("returns only what must still be removed before scoring", () => {
    const rows = [
      row({ refused_org_id: "fresh" }),
      row({ refused_org_id: "lapsed", first_declared_at: daysAgo(1200) }),
      row({ refused_org_id: "retired", retired_at: daysAgo(5) }),
      row({ refused_org_id: "renewed", first_declared_at: daysAgo(1200), reaffirmed_at: daysAgo(2) }),
    ];
    expect(enforcedPairs(rows, NOW, POLICY).map((p) => p.refusedOrgId)).toEqual([
      "fresh",
      "renewed",
    ]);
  });
});

describe("thawPrompts", () => {
  const rows = [
    row({ refused_org_id: "ancient", first_declared_at: daysAgo(900) }),
    row({ refused_org_id: "old", first_declared_at: daysAgo(400) }),
    row({ refused_org_id: "recent" }),
    row({ refused_org_id: "lapsed", first_declared_at: daysAgo(2000) }),
  ];

  it("raises the oldest still-standing refusals first", () => {
    expect(thawPrompts(rows, NOW, POLICY).map((p) => p.refusedOrgId)).toEqual([
      "ancient",
      "old",
    ]);
  });

  it("addresses the party who DECLARED it, never the refused one", () => {
    // ⛔ Approaching the refused org tells them they were refused — the refusal
    // leaking through outreach instead of through the score.
    const [first] = thawPrompts(rows, NOW, POLICY);
    expect(first.declaringOrgId).toBe("member");
    expect(first.declaredByContactId).toBe("karin");
  });

  it("says nothing when everything is fresh or already lapsed", () => {
    expect(thawPrompts([rows[2], rows[3]], NOW, POLICY)).toEqual([]);
  });
});
