import { describe, expect, it } from "vitest";
import { runMatch, revealedTermsByOrg, revealedAffinityByOrg, describeRun } from "../runner";
import type { MatchProfileInput } from "../profile";
import type { AffinityRollup, TermRollup } from "@/lib/signals/types";

const NOW = new Date("2026-08-31T12:00:00Z");

function org(id: string, type: "Member" | "Vendor Partner", over: Partial<MatchProfileInput> = {}): MatchProfileInput {
  return { id, name: id, type, ...over };
}

function term(o: string, t: string, weight: number, over: Partial<TermRollup> = {}): TermRollup {
  return {
    organizationId: o, contactId: null, term: t, termSource: "synonym", stance: "implicit",
    polarity: "positive", weight, eventCount: 1, actorCount: 1,
    firstSeenAt: NOW, lastSeenAt: NOW, ...over,
  };
}

describe("runMatch", () => {
  const orgs = [
    org("m1", "Member", { procurement_info: { category_buyers: [{ category: "Apparel", contact_ids: [] }] } }),
    org("m2", "Member", { procurement_info: { category_buyers: [{ category: "Books", contact_ids: [] }] } }),
    org("p1", "Vendor Partner", { primary_category: "Apparel, Activewear" }),
    org("p2", "Vendor Partner", { primary_category: "Books, Textbooks" }),
  ];

  it("produces all four directions from one pass", () => {
    const { summary } = runMatch({ organizations: orgs, now: NOW });
    expect(summary.perDirection.map((d) => d.direction)).toEqual([
      "member_to_partner", "partner_to_member", "member_to_member", "partner_to_partner",
    ]);
    expect(summary.profiles).toMatchObject({ member: 2, partner: 2 });
  });

  it("⛔ never lets an archived or test org into a candidate pool", () => {
    const { edges, summary } = runMatch({
      organizations: [
        ...orgs,
        org("gone", "Vendor Partner", { primary_category: "Apparel", archived_at: "2026-01-01" }),
        org("fake", "Vendor Partner", { primary_category: "Apparel", is_test: true }),
      ],
      now: NOW,
    });
    expect(summary.profiles.skipped).toBe(2);
    expect(edges.some((e) => e.candidateOrgId === "gone" || e.candidateOrgId === "fake")).toBe(false);
  });

  it("stores `total` as ranking, not the raw score", () => {
    const { edges } = runMatch({ organizations: orgs, now: NOW });
    const edge = edges.find((e) => e.direction === "member_to_partner")!;
    // Coverage is thin here, so ranking must sit below score rather than equal it.
    expect(edge.total).toBeLessThan(edge.score);
    expect(edge.total).toBeGreaterThan(0);
  });

  it("stores every reason with its provenance, and withholds nothing itself", () => {
    const { edges } = runMatch({
      organizations: [
        org("m", "Member", {
          procurement_info: {
            category_buyers: [{ category: "Apparel", contact_ids: [] }],
            preferred_certifications: ["Fair Trade"],
            show_certifications: false,
          },
        }),
        org("p", "Vendor Partner", { primary_category: "Apparel", certifications: ["Fair Trade"] }),
      ],
      now: NOW,
    });
    const outbound = edges.find((e) => e.direction === "partner_to_member")!;
    const reasons = outbound.reasons as { axis: string; sourceOrgId: string | null; sourceVisibility: string }[];

    // Nothing is dropped at write time — the row carries the facts and every
    // surface decides for itself who may read what.
    const cert = reasons.find((r) => r.axis === "certification")!;
    expect(cert.sourceOrgId).toBe("m");
    expect(cert.sourceVisibility).toBe("hidden");
  });

  it("⚠️ reports what the cap dropped rather than swallowing it", () => {
    const many = [
      org("m", "Member", { procurement_info: { category_buyers: [{ category: "Apparel", contact_ids: [] }] } }),
      ...Array.from({ length: 10 }, (_, i) => org(`p${i}`, "Vendor Partner", { primary_category: "Apparel" })),
    ];
    const { summary, edges } = runMatch({ organizations: many, now: NOW, topPerSubject: 3 });
    const m2p = summary.perDirection.find((d) => d.direction === "member_to_partner")!;
    expect(m2p.edgesKept).toBe(3);
    expect(m2p.edgesDroppedByCap).toBe(7);
    expect(edges.filter((e) => e.direction === "member_to_partner")).toHaveLength(3);
    expect(describeRun(summary)).toContain("not stored");
    // The count alone is uninformative — the best dropped edge says whether to care.
    expect(m2p.bestDroppedTotal).not.toBeNull();
  });

  it("feeds revealed terms through into the score", () => {
    const base = runMatch({ organizations: orgs, now: NOW });
    const withSignal = runMatch({
      organizations: orgs,
      termRollups: [term("m1", "Activewear", 10)],
      now: NOW,
    });
    const before = base.edges.find((e) => e.subjectOrgId === "m1" && e.candidateOrgId === "p1")!;
    const after = withSignal.edges.find((e) => e.subjectOrgId === "m1" && e.candidateOrgId === "p1")!;
    expect(after.breakdown.category!).toBeGreaterThanOrEqual(before.breakdown.category!);
    expect(withSignal.summary.revealed.orgsWithTerms).toBe(1);
  });
});

describe("rollups → revealed evidence", () => {
  it("normalises per org, so a busy store does not outrank a quiet one on volume", () => {
    const byOrg = revealedTermsByOrg([
      term("big", "Activewear", 100), term("big", "Headwear", 50),
      term("small", "Activewear", 2),
    ]);
    expect(byOrg.get("big")![0].weight).toBeCloseTo(1);
    expect(byOrg.get("small")![0].weight).toBeCloseTo(1);
    expect(byOrg.get("big")![1].weight).toBeCloseTo(0.5);
  });

  it("drops negative term signal rather than presenting it as an interest", () => {
    const byOrg = revealedTermsByOrg([
      term("o", "Activewear", 5),
      term("o", "Headwear", 9, { polarity: "negative", stance: "explicit", termSource: "category" }),
    ]);
    expect(byOrg.get("o")!.map((t) => t.term)).toEqual(["Activewear"]);
  });

  it("keeps a refusal at full strength instead of scaling it against browsing", () => {
    const affinity: AffinityRollup[] = [
      { organizationId: "o", contactId: null, objectOrgId: "liked", weight: 40, stance: "implicit", polarity: "positive", eventCount: 12, actorCount: 3, lastSeenAt: NOW },
      { organizationId: "o", contactId: null, objectOrgId: "refused", weight: 10, stance: "explicit", polarity: "negative", eventCount: 1, actorCount: 1, lastSeenAt: NOW },
    ];
    const byOrg = revealedAffinityByOrg(affinity);
    const rows = byOrg.get("o")!;
    expect(rows.find((r) => r.orgId === "liked")!.weight).toBeCloseTo(1);
    // A declaration is not a quantity — it does not get divided by how much
    // someone happened to browse.
    expect(rows.find((r) => r.orgId === "refused")!.weight).toBe(1);
  });
});
