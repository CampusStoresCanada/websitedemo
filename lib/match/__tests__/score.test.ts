import { describe, expect, it } from "vitest";
import { scorePair, rankCandidates, matchTotal } from "../score";
import { reasonsVisibleTo } from "../edge-view";
import { buildMatchProfile, parseMonthRange, parseMonth } from "../profile";
import { semanticFeature, categoryFeature, provinceFeature } from "../features";
import type { MatchProfile } from "../types";

/** Minimal profile with sane blanks; override only what a test is about. */
function profile(overrides: Partial<MatchProfile> & Pick<MatchProfile, "id" | "type">): MatchProfile {
  return {
    name: overrides.id,
    departments: [],
    classes: [],
    certificationsHeld: [],
    certificationsWanted: [],
    isCancoll: false,
    province: null,
    sourcingProvinces: [],
    buyingCycle: null,
    requirementsNotes: null,
    descriptionText: null,
    storeServices: [],
    fte: null,
    scaleRange: null,
    institutionType: null,
    visibility: {},
    buyers: [],
    revealedTerms: [],
    revealedAffinities: [],
    embedding: null,
    embeddingModel: null,
    ...overrides,
  };
}

const NOW = new Date("2026-08-31T12:00:00Z");

describe("absence is not a zero", () => {
  it("scores a thin profile on fit, and records the thinness as confidence", () => {
    const member = profile({
      id: "m1",
      type: "member",
      classes: ["Activewear"],
      departments: ["Apparel"],
    });
    const partner = profile({
      id: "p1",
      type: "partner",
      classes: ["Activewear"],
      departments: ["Apparel"],
    });

    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });

    // Category was the only axis with anything to say, and it matched well.
    expect(pair.score).toBeGreaterThan(90);
    // ...but we know almost nothing about them, and the score must admit it.
    expect(pair.confidence).toBeLessThan(0.4);
    expect(pair.ranking).toBeLessThan(pair.score);
    expect(pair.breakdown.certification).toBeNull();
    expect(pair.breakdown.province).toBeNull();
  });

  it("ranks a complete profile above a thin one at equal fit quality", () => {
    const member = profile({
      id: "m1",
      type: "member",
      departments: ["Apparel"],
      classes: ["Activewear"],
      certificationsWanted: ["Fair Trade"],
      sourcingProvinces: ["Ontario"],
    });
    const thin = profile({
      id: "thin",
      type: "partner",
      departments: ["Apparel"],
      classes: ["Activewear"],
    });
    const complete = profile({
      id: "complete",
      type: "partner",
      departments: ["Apparel"],
      classes: ["Activewear"],
      certificationsHeld: ["Fair Trade"],
      province: "Ontario",
    });

    const ranked = rankCandidates(member, [thin, complete], "member_to_partner", { now: NOW });
    expect(ranked[0].candidateId).toBe("complete");
    expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence);
  });
});

describe("certification — the hard vocabulary join", () => {
  it("fires as a `chosen` reason naming the certifications met", () => {
    const ubc = profile({
      id: "ubc",
      type: "member",
      certificationsWanted: ["Fair Trade", "Indigenous Owned"],
    });
    const supplier = profile({
      id: "s",
      type: "partner",
      certificationsHeld: ["Fair Trade", "B Corp"],
    });

    const pair = scorePair(ubc, supplier, "member_to_partner", { now: NOW });
    expect(pair.breakdown.certification).toBeCloseTo(0.5);

    const reason = pair.reasons.find((r) => r.axis === "certification");
    expect(reason?.kind).toBe("chosen");
    expect(reason?.evidence).toEqual(["Fair Trade"]);
  });

  it("stays silent when the buyer never stated a preference", () => {
    const member = profile({ id: "m", type: "member" });
    const partner = profile({ id: "p", type: "partner", certificationsHeld: ["B Corp"] });
    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });
    expect(pair.breakdown.certification).toBeNull();
  });
});

describe("province", () => {
  it("matches the supplier's province against the buyer's sourcing list", () => {
    const buyer = profile({ id: "b", type: "member", sourcingProvinces: ["Ontario"] });
    const supplier = profile({ id: "s", type: "partner", province: "Ontario" });
    expect(provinceFeature(buyer, supplier).value).toBe(1);
  });

  it("treats a member who ticked every province as expressing no constraint", () => {
    // One live record lists all thirteen — that is silence, not a match with everyone.
    const buyer = profile({
      id: "b",
      type: "member",
      sourcingProvinces: [
        "Alberta", "British Columbia", "Manitoba", "New Brunswick",
        "Newfoundland and Labrador", "Nova Scotia", "Ontario",
        "Prince Edward Island", "Quebec", "Saskatchewan",
        "Northwest Territories", "Nunavut", "Yukon",
      ],
    });
    const supplier = profile({ id: "s", type: "partner", province: "Ontario" });
    expect(provinceFeature(buyer, supplier).value).toBeNull();
  });
});

describe("category", () => {
  const ctx = { direction: "member_to_partner" as const, now: NOW };

  it("scores a class match well above a department-only match", () => {
    const subject = profile({ id: "a", type: "member", departments: ["Apparel"], classes: ["Activewear"] });
    const precise = profile({ id: "b", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });
    const broad = profile({ id: "c", type: "partner", departments: ["Apparel"], classes: ["Headwear"] });

    const preciseValue = categoryFeature(subject, precise, ctx).value!;
    const broadValue = categoryFeature(subject, broad, ctx).value!;
    expect(preciseValue).toBeGreaterThan(0.9);
    expect(broadValue).toBeLessThanOrEqual(0.35);
  });

  it("⛔ says nothing about two unrelated partners, rather than inventing a floor", () => {
    // A 0.25 floor here made 61% of partner_to_partner edges one constant on the
    // first real run — "we have no idea" stored as a rank.
    const p2p = { direction: "partner_to_partner" as const, now: NOW };
    const a = profile({ id: "a", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });
    const unrelated = profile({ id: "b", type: "partner", departments: ["Books"], classes: ["Textbooks"] });
    expect(categoryFeature(a, unrelated, p2p).value).toBeNull();
  });

  it("inverts between partners — same class is a rival, same department a complement", () => {
    const p2p = { direction: "partner_to_partner" as const, now: NOW };
    const subject = profile({ id: "a", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });
    const rival = profile({ id: "b", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });
    const complement = profile({ id: "c", type: "partner", departments: ["Apparel"], classes: ["Headwear"] });

    expect(categoryFeature(subject, rival, p2p).value!).toBeLessThan(
      categoryFeature(subject, complement, p2p).value!
    );
  });
});

describe("reason ordering and derived badges", () => {
  it("puts reasons that argue for the match above reasons that explain a gap", () => {
    const member = profile({
      id: "m",
      type: "member",
      departments: ["Apparel"],
      certificationsWanted: ["Fair Trade"],
    });
    // Matches on category, misses on certification — both reasons are `chosen`.
    const partner = profile({ id: "p", type: "partner", departments: ["Apparel"] });

    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });
    expect(pair.reasons[0].supports).toBe(true);
    expect(pair.reasons[0].axis).toBe("category");
    expect(pair.reasons.some((r) => !r.supports && r.axis === "certification")).toBe(true);
  });

  it("does not present a location-derived badge as a chosen certification", () => {
    // "Buy Ontario" is on 65 partners, every one of them in Ontario — it is the
    // province column wearing a badge, and the province axis already scores it.
    const member = profile({ id: "m", type: "member", certificationsWanted: ["Buy Ontario"] });
    const partner = profile({
      id: "p",
      type: "partner",
      province: "Ontario",
      certificationsHeld: ["Buy Ontario"],
    });

    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });
    const reason = pair.reasons.find((r) => r.axis === "certification");
    expect(reason?.kind).toBe("derived");
    expect(reason?.text).toContain("Inferred from location");
  });

  it("still reports a real certification as chosen when one is present", () => {
    const member = profile({
      id: "m",
      type: "member",
      certificationsWanted: ["Buy Ontario", "Fair Trade"],
    });
    const partner = profile({
      id: "p",
      type: "partner",
      certificationsHeld: ["Buy Ontario", "Fair Trade"],
    });

    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });
    const reason = pair.reasons.find((r) => r.axis === "certification");
    expect(reason?.kind).toBe("chosen");
    expect(reason?.text).toContain("Fair Trade");
    expect(reason?.text).not.toContain("Buy Ontario");
  });
});

describe("visibility redaction", () => {
  it("scores on a hidden axis but refuses to cite it to the other party", () => {
    const member = profile({
      id: "m",
      type: "member",
      certificationsWanted: ["Fair Trade"],
      visibility: { show_certifications: false },
    });
    const partner = profile({ id: "p", type: "partner", certificationsHeld: ["Fair Trade"] });

    // Partner is the audience here, so the member's hidden preference must not surface.
    const outbound = scorePair(partner, member, "partner_to_member", { now: NOW });
    expect(outbound.breakdown.certification).toBe(1);
    expect(outbound.reasons.some((r) => r.axis === "certification")).toBe(true);
    expect(reasonsVisibleTo(outbound.reasons as never, partner.id).some((r) => r.axis === "certification")).toBe(false);

    // The member looking at their own list can always see their own answer.
    const inbound = scorePair(member, partner, "member_to_partner", { now: NOW });
    expect(reasonsVisibleTo(inbound.reasons as never, member.id).some((r) => r.axis === "certification")).toBe(true);
  });
});

describe("timing", () => {
  it("reads an open RFP window that wraps the year end", () => {
    // UBC: "November - February". In December that window is open.
    const member = profile({
      id: "ubc",
      type: "member",
      buyingCycle: {
        fiscalYearStartMonth: 4,
        rfpWindow: { startMonth: 11, endMonth: 2 },
        keyDates: [],
        notes: "",
      },
    });
    const partner = profile({ id: "p", type: "partner" });

    const december = scorePair(partner, member, "partner_to_member", {
      now: new Date("2026-12-05T00:00:00Z"),
    });
    expect(december.breakdown.timing).toBe(1);

    const july = scorePair(partner, member, "partner_to_member", {
      now: new Date("2026-07-05T00:00:00Z"),
    });
    expect(july.breakdown.timing).toBeLessThan(1);
  });

  it("surfaces an approaching recurring deadline", () => {
    // Algonquin: Winter Textbook Adoption deadline, recurring 15 October.
    const member = profile({
      id: "algonquin",
      type: "member",
      buyingCycle: {
        fiscalYearStartMonth: 4,
        rfpWindow: null,
        keyDates: [{ title: "Winter Textbook Adoption deadline", date: "2026-10-15", recurring: true }],
        notes: "",
      },
    });
    const partner = profile({ id: "p", type: "partner" });

    const pair = scorePair(partner, member, "partner_to_member", { now: NOW });
    expect(pair.breakdown.timing).toBeGreaterThan(0.5);
    const reason = pair.reasons.find((r) => r.axis === "timing");
    expect(reason?.text).toContain("Winter Textbook Adoption deadline");
    expect(reason?.kind).toBe("stated");
  });
});

describe("requirements notes", () => {
  it("credits a buy-local policy naming the supplier's province", () => {
    // UBC's live note: "Buy local: BC-based vendors given preference..."
    const ubc = profile({
      id: "ubc",
      type: "member",
      requirementsNotes:
        "Buy local: British Columbia vendors given preference where pricing is competitive. Indigenous Owned suppliers prioritised.",
    });
    const local = profile({
      id: "local",
      type: "partner",
      province: "British Columbia",
      certificationsHeld: ["Indigenous Owned"],
    });

    const pair = scorePair(ubc, local, "member_to_partner", { now: NOW });
    expect(pair.breakdown.requirements).toBe(1);
    expect(pair.reasons.some((r) => r.axis === "requirements" && r.kind === "stated")).toBe(true);
  });

  it("stays silent when the notes hold nothing a vocabulary can confirm", () => {
    const member = profile({
      id: "m",
      type: "member",
      requirementsNotes: "Please send a rate card before the meeting.",
    });
    const partner = profile({ id: "p", type: "partner", province: "Ontario" });
    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });
    expect(pair.breakdown.requirements).toBeNull();
  });
});

describe("semantic", () => {
  it("refuses to compare vectors from different models", () => {
    const a = profile({ id: "a", type: "member", embedding: [1, 0, 0], embeddingModel: "voyage-3" });
    const b = profile({ id: "b", type: "partner", embedding: [1, 0, 0], embeddingModel: "bge-m3" });
    expect(semanticFeature(a, b).value).toBeNull();
  });

  it("compares vectors from the same model", () => {
    const a = profile({ id: "a", type: "member", embedding: [1, 1, 0], embeddingModel: "bge-m3" });
    const b = profile({ id: "b", type: "partner", embedding: [1, 1, 0], embeddingModel: "bge-m3" });
    expect(semanticFeature(a, b).value).toBeCloseTo(1);
  });
});

describe("what the engine refuses to decide", () => {
  it("drops an org scored against itself", () => {
    const member = profile({ id: "m", type: "member", departments: ["Apparel"] });
    const pair = scorePair(member, member, "member_to_partner", { now: NOW });
    expect(pair.notScorable).toBe(true);
    expect(pair.notScorableReason).toBe("self");
  });

  it("refuses a pair whose types do not fit the direction", () => {
    const a = profile({ id: "a", type: "member" });
    const b = profile({ id: "b", type: "member" });
    const pair = scorePair(a, b, "member_to_partner", { now: NOW });
    expect(pair.notScorable).toBe(true);
    expect(pair.notScorableReason).toBe("direction_type_mismatch");
  });

  it("⛔ never removes a candidate for a relationship reason", () => {
    // A refusal is a human fact — "they failed to deliver fourteen years ago".
    // No algorithm can infer it and it must not be delegated to one. The engine
    // has no blocklist input at all; consumers filter on the declaration itself,
    // before and independently of any score.
    const member = profile({ id: "m", type: "member", departments: ["Apparel"] });
    const refused = profile({ id: "refused", type: "partner", departments: ["Apparel"] });
    const other = profile({ id: "other", type: "partner", departments: ["Apparel"] });

    const ranked = rankCandidates(member, [refused, other], "member_to_partner", { now: NOW });
    // Both come back. Enforcement is not this layer's job.
    expect(ranked.map((r) => r.candidateId).sort()).toEqual(["other", "refused"]);
    expect(ranked.every((r) => !r.notScorable)).toBe(true);
  });
});

describe("matchTotal — the contract surface", () => {
  it("returns ranking, not the raw score, so a thin match cannot outrank a known one", () => {
    const member = profile({
      id: "m",
      type: "member",
      departments: ["Apparel"],
      classes: ["Activewear"],
      certificationsWanted: ["Fair Trade"],
      sourcingProvinces: ["Ontario"],
    });
    const thin = profile({ id: "thin", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });
    const known = profile({
      id: "known",
      type: "partner",
      departments: ["Apparel"],
      classes: ["Activewear"],
      certificationsHeld: ["Fair Trade"],
      province: "Ontario",
    });

    const thinPair = scorePair(member, thin, "member_to_partner", { now: NOW });
    const knownPair = scorePair(member, known, "member_to_partner", { now: NOW });

    // Raw score alone would rank these level or backwards.
    expect(matchTotal(knownPair)).toBeGreaterThan(matchTotal(thinPair));
    expect(matchTotal(knownPair)).toBe(knownPair.ranking);
  });

  it("gives a non-scorable pair a total of zero rather than a misleading number", () => {
    const a = profile({ id: "a", type: "member" });
    expect(matchTotal(scorePair(a, a, "member_to_partner", { now: NOW }))).toBe(0);
  });
});

describe("profile building", () => {
  it("parses free-text RFP seasons, including wrap-around", () => {
    expect(parseMonthRange("February - April")).toEqual({ startMonth: 2, endMonth: 4 });
    expect(parseMonthRange("Jan – June")).toEqual({ startMonth: 1, endMonth: 6 });
    expect(parseMonthRange("November to February")).toEqual({ startMonth: 11, endMonth: 2 });
    expect(parseMonthRange("whenever we feel like it")).toBeNull();
    expect(parseMonth("April")).toBe(4);
  });

  it("reads member categories out of category_buyers, since members have no primary_category", () => {
    const built = buildMatchProfile({
      id: "m",
      name: "Algonquin College",
      type: "Member",
      primary_category: null,
      procurement_info: {
        category_buyers: [
          { category: "Apparel", contact_ids: ["c1"], contact_subcategories: { c1: ["Activewear"] } },
        ],
        store_services: ["Print & Photocopy"],
        preferred_certifications: ["Buy Ontario"],
      },
    });

    expect(built?.departments).toContain("Apparel");
    expect(built?.classes).toContain("Activewear");
    expect(built?.storeServices).toEqual(["Print & Photocopy"]);
    expect(built?.certificationsWanted).toEqual(["Buy Ontario"]);
  });

  it("treats an empty buying-cycle shell as no cycle at all", () => {
    // The editor writes "" into every field on first save.
    const built = buildMatchProfile({
      id: "m",
      name: "Sheridan College",
      type: "Member",
      procurement_info: {
        buying_cycle: { rfp_window: "", key_dates_notes: "", fiscal_year_start: "" },
      },
    });
    expect(built?.buyingCycle).toBeNull();
  });

  it("survives the legacy free-text key_dates that once took profile pages down", () => {
    const built = buildMatchProfile({
      id: "m",
      name: "Legacy",
      type: "Member",
      procurement_info: {
        // Written by the onboarding wizard for years while readers assumed KeyDate[].
        buying_cycle: { key_dates: "Textbook orders due in June" as never },
      },
    });
    expect(built?.buyingCycle?.keyDates).toEqual([]);
    expect(built?.buyingCycle?.notes).toBe("Textbook orders due in June");
  });

  it("⛔ refuses an archived org, so no caller can recommend a dead one", () => {
    // 41 of 122 partner orgs are archived, and archiving leaves no audit trail
    // and does not stop billing. One forgotten `.is("archived_at", null)` would
    // otherwise put a dead org in front of a member.
    expect(
      buildMatchProfile({
        id: "gone",
        name: "Archived Vendor",
        type: "Vendor Partner",
        primary_category: "Apparel",
        archived_at: "2026-03-01T00:00:00Z",
      })
    ).toBeNull();
  });

  it("keeps test orgs out unless asked for explicitly", () => {
    const row = { id: "t", name: "Test Org", type: "Member" as const, is_test: true };
    expect(buildMatchProfile(row)).toBeNull();
    expect(buildMatchProfile(row, { includeTestOrgs: true })).not.toBeNull();
  });

  it("ignores an org type outside the two that match", () => {
    expect(buildMatchProfile({ id: "x", name: "Staff", type: "Staff" })).toBeNull();
    // ⚠️ organizations.type is capitalized — a lowercase filter returns nothing, silently.
    expect(buildMatchProfile({ id: "x", name: "member", type: "member" })).toBeNull();
  });
});


describe("revealed behaviour — the consumer", () => {
  it("supplies the class precision the form never had", () => {
    // 0 of 81 members set primary_category and only one filled in
    // subcategories, so chosen data is department-level at best. People search
    // for classes. This is the case the whole signal layer exists for.
    const member = profile({ id: "m", type: "member", departments: ["Apparel"] });
    const broad = profile({ id: "broad", type: "partner", departments: ["Apparel"], classes: ["Headwear"] });

    const before = scorePair(member, broad, "member_to_partner", { now: NOW });
    expect(before.breakdown.category).toBeCloseTo(0.35);

    const after = scorePair(
      { ...member, revealedTerms: [{ term: "Headwear", weight: 1, source: "synonym", actorCount: 3 }] },
      broad,
      "member_to_partner",
      { now: NOW }
    );
    expect(after.breakdown.category!).toBeGreaterThan(before.breakdown.category!);
  });

  it("reports behaviour as behavioural, never as something they chose", () => {
    const member = profile({
      id: "m", type: "member", departments: ["Apparel"],
      revealedTerms: [{ term: "Activewear", weight: 0.9, source: "synonym", actorCount: 2 }],
    });
    const partner = profile({ id: "p", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });

    const reason = scorePair(member, partner, "member_to_partner", { now: NOW })
      .reasons.find((r) => r.kind === "behavioural");
    expect(reason?.text).toContain("Activewear");
    // No count, no person — the aggregate framing is the sentence itself.
    expect(reason?.text).not.toMatch(/\d/);
  });

  it("ranks a declared class match above a merely searched one", () => {
    // Behaviour is interest; a selection is a statement.
    const chose = scorePair(
      profile({ id: "m1", type: "member", departments: ["Apparel"], classes: ["Activewear"] }),
      profile({ id: "p", type: "partner", departments: ["Apparel"], classes: ["Activewear"] }),
      "member_to_partner", { now: NOW }
    );
    const searched = scorePair(
      profile({ id: "m2", type: "member", departments: ["Apparel"],
        revealedTerms: [{ term: "Activewear", weight: 1, source: "synonym", actorCount: 1 }] }),
      profile({ id: "p", type: "partner", departments: ["Apparel"], classes: ["Activewear"] }),
      "member_to_partner", { now: NOW }
    );
    expect(chose.breakdown.category!).toBeGreaterThan(searched.breakdown.category!);
  });

  it("fills the behavioural axis from org-to-org pull", () => {
    const member = profile({
      id: "m", type: "member", departments: ["Apparel"],
      revealedAffinities: [{ orgId: "p", weight: 0.8, stance: "implicit", polarity: "positive", actorCount: 4 }],
    });
    const partner = profile({ id: "p", type: "partner", departments: ["Apparel"] });
    expect(scorePair(member, partner, "member_to_partner", { now: NOW }).breakdown.behavioural)
      .toBeCloseTo(0.8);
  });

  it("⛔ zeroes a refused pair's behavioural axis but still returns the pair", () => {
    // A score may never be the reason two orgs do not meet. Enforcement reads
    // the declaration, elsewhere and independently.
    const member = profile({
      id: "m", type: "member", departments: ["Apparel"],
      revealedAffinities: [
        { orgId: "p", weight: 0.9, stance: "implicit", polarity: "positive", actorCount: 5 },
        { orgId: "p", weight: 1, stance: "explicit", polarity: "negative", actorCount: 1 },
      ],
    });
    const partner = profile({ id: "p", type: "partner", departments: ["Apparel"] });

    const pair = scorePair(member, partner, "member_to_partner", { now: NOW });
    expect(pair.breakdown.behavioural).toBe(0);
    expect(pair.notScorable).toBe(false);
    // ...and the refusal is never disclosed to the partner.
    const outbound = scorePair(partner, { ...member, revealedAffinities: [] }, "partner_to_member", { now: NOW });
    expect(outbound.reasons.some((r) => r.text.includes("declined"))).toBe(false);
  });

  it("does not average an explicit signal into implicit noise", () => {
    const member = profile({
      id: "m", type: "member", departments: ["Apparel"],
      revealedAffinities: [
        { orgId: "p", weight: 0.1, stance: "implicit", polarity: "positive", actorCount: 1 },
        { orgId: "p", weight: 0.9, stance: "explicit", polarity: "positive", actorCount: 1 },
      ],
    });
    const partner = profile({ id: "p", type: "partner", departments: ["Apparel"] });
    // Explicit wins outright rather than being diluted to 0.5.
    expect(scorePair(member, partner, "member_to_partner", { now: NOW }).breakdown.behavioural)
      .toBeCloseTo(0.9);
  });
});


describe("what can be taken out of this", () => {
  it("uses the member's own searches when a PARTNER asks who could buy from them", () => {
    // The signal that matters in partner_to_member sits on the CANDIDATE. An
    // asymmetric read gave a partner asking "who could buy from me" none of it.
    const partner = profile({ id: "p", type: "partner", departments: ["Apparel"], classes: ["Activewear"] });
    const member = profile({
      id: "m", type: "member", departments: ["Apparel"],
      revealedTerms: [{ term: "Activewear", weight: 0.9, source: "synonym", actorCount: 3 }],
    });

    const pair = scorePair(partner, member, "partner_to_member", { now: NOW });
    const reason = pair.reasons.find((r) => r.kind === "behavioural");
    expect(reason).toBeDefined();
    // ⚠️ Another org's behaviour may be described only as interest — never how
    // much, never how many, never who.
    expect(reason!.text).toContain("Recent interest there");
    expect(reason!.text).not.toMatch(/\d/);
  });

  it("records whose data each reason reveals, and decides nothing", () => {
    const member = profile({
      id: "m", type: "member",
      certificationsWanted: ["Fair Trade"],
      visibility: { show_certifications: false },
    });
    const partner = profile({ id: "p", type: "partner", certificationsHeld: ["Fair Trade"] });

    const outbound = scorePair(partner, member, "partner_to_member", { now: NOW });
    const cert = outbound.reasons.find((r) => r.axis === "certification")!;

    // The engine states the facts a consumer needs; it does not pick an audience.
    expect(cert.sourceOrgId).toBe("m");
    expect(cert.sourceVisibility).toBe("hidden");

    // ...and the same stored row answers differently for different readers.
    expect(reasonsVisibleTo(outbound.reasons as never, "p").some((r) => r.axis === "certification")).toBe(false);
    expect(reasonsVisibleTo(outbound.reasons as never, "m").some((r) => r.axis === "certification")).toBe(true);
  });
});


describe("⛔ visibility gates DISPLAY, never the score", () => {
  const buyer = (visibility: MatchProfile["visibility"]) =>
    profile({
      id: "m",
      type: "member",
      departments: ["Apparel"],
      classes: ["Activewear"],
      certificationsWanted: ["Fair Trade"],
      sourcingProvinces: ["Ontario"],
      storeServices: ["Print & Photocopy"],
      buyingCycle: { fiscalYearStartMonth: 4, rfpWindow: { startMonth: 1, endMonth: 12 }, keyDates: [], notes: "" },
      visibility,
    });

  const supplier = profile({
    id: "p",
    type: "partner",
    departments: ["Apparel"],
    classes: ["Activewear"],
    certificationsHeld: ["Fair Trade"],
    province: "Ontario",
  });

  const HIDE_EVERYTHING = {
    show_categories: false,
    show_certifications: false,
    show_provinces: false,
    show_buying_cycle: false,
    show_store_services: false,
  };

  it("scores identically whether every section is hidden or shown", () => {
    // A member who hides their procurement detail from partners is still a
    // member who buys Activewear. Hiding is about who may be TOLD, never about
    // what is true — so the number must not move.
    const open = scorePair(supplier, buyer({}), "partner_to_member", { now: NOW });
    const shut = scorePair(supplier, buyer(HIDE_EVERYTHING), "partner_to_member", { now: NOW });

    expect(shut.score).toBe(open.score);
    expect(shut.ranking).toBe(open.ranking);
    expect(shut.confidence).toBe(open.confidence);
    expect(shut.breakdown).toEqual(open.breakdown);
  });

  it("moves every reason to the withheld half instead", () => {
    const shut = scorePair(supplier, buyer(HIDE_EVERYTHING), "partner_to_member", { now: NOW });

    // Same evidence, all of it stored, each marked with whose it is.
    expect(shut.reasons.length).toBeGreaterThan(0);
    expect(shut.reasons.some((r) => r.sourceVisibility === "hidden")).toBe(true);
    // A partner reading it sees less; the member reading the same row sees all.
    expect(reasonsVisibleTo(shut.reasons as never, "p").length)
      .toBeLessThan(reasonsVisibleTo(shut.reasons as never, "m").length);
  });

  it("still tells the member their own hidden answers", () => {
    // Hiding is directional: it conceals from partners, not from the person who
    // set it. The same member reading their own list sees everything.
    const own = scorePair(buyer(HIDE_EVERYTHING), supplier, "member_to_partner", { now: NOW });
    expect(reasonsVisibleTo(own.reasons as never, "m").length).toBe(own.reasons.length);
  });
});


describe("⛔ who buys what, not just what the org buys", () => {
  it("keeps each person's ownership instead of unioning it away", () => {
    // Live shape: one person across several departments, several people sharing
    // one. Algonquin has exactly both.
    const built = buildMatchProfile({
      id: "m",
      name: "Algonquin College",
      type: "Member",
      procurement_info: {
        category_buyers: [
          {
            category: "Apparel",
            contact_ids: ["zach"],
            contact_subcategories: { zach: ["Activewear", "Headwear"] },
          },
          {
            category: "Books",
            contact_ids: ["karin", "mo"],
            contact_subcategories: { karin: ["Textbooks"], mo: ["eBooks"] },
          },
        ],
      },
    })!;

    const zach = built.buyers.find((b) => b.contactId === "zach")!;
    const karin = built.buyers.find((b) => b.contactId === "karin")!;

    expect(zach.classes).toEqual(["Activewear", "Headwear"]);
    expect(karin.classes).toEqual(["Textbooks"]);
    // ⛔ The whole point: Zach does NOT own Books just because his store does.
    expect(zach.departments).not.toContain("Books");
    expect(karin.departments).not.toContain("Apparel");
    expect(built.buyers.map((b) => b.contactId).sort()).toEqual(["karin", "mo", "zach"]);
  });

  it("leaves the org's own answer exactly as it was", () => {
    // Un-flattening adds detail underneath; it must not change what the store
    // is understood to buy, or every existing edge would shift.
    const built = buildMatchProfile({
      id: "m",
      name: "m",
      type: "Member",
      procurement_info: {
        category_buyers: [
          { category: "Apparel", contact_ids: ["a"], contact_subcategories: { a: ["Activewear"] } },
        ],
      },
    })!;
    expect(built.departments).toContain("Apparel");
    expect(built.classes).toContain("Activewear");
  });

  it("counts being named on a category as ownership even with no classes given", () => {
    const built = buildMatchProfile({
      id: "m",
      name: "m",
      type: "Member",
      procurement_info: { category_buyers: [{ category: "Books", contact_ids: ["solo"] }] },
    })!;
    expect(built.buyers).toHaveLength(1);
    expect(built.buyers[0]).toMatchObject({ contactId: "solo", departments: ["Books"] });
  });
});
