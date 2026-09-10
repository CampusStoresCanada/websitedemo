import { describe, expect, it } from "vitest";
import {
  resolveText, resolveDocument, resolveSpaceName, resolveCategoryClick,
  RESOLVER_VERSION, needsReresolution,
} from "../resolve";
import { decayedWeight, VERB_PROFILES } from "../decay";
import {
  rollupTerms, rollupAffinity, bestPerTerm, normalizeTermWeights, termKey,
  unresolvedDemand, staleResolutions, collapseToOrg,
} from "../aggregate";
import { bandCount, summarizeImpressions, describeImpressions, MIN_DISCLOSURE_COHORT } from "../disclosure";
import type { SignalEvent } from "../types";

const NOW = new Date("2026-08-31T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function event(overrides: Partial<SignalEvent> = {}): SignalEvent {
  return {
    occurredAt: NOW,
    source: "website",
    verb: "searched",
    actorOrgId: "org-a",
    actorContactId: "person-1",
    stance: "implicit",
    polarity: "positive",
    objectType: "query",
    objectOrgId: null,
    objectRef: null,
    rawText: null,
    terms: ["Activewear"],
    termSource: "synonym",
    resolverVersion: "test.1",
    weight: VERB_PROFILES.searched.weight,
    dedupeKey: null,
    ...overrides,
  };
}

describe("resolving acts into taxonomy terms", () => {
  it("turns a search for hoodies into the terms the match engine scores on", () => {
    const resolved = resolveText("hoodies");
    expect(resolved.terms).toContain("Apparel");
    expect(resolved.terms).toContain("Activewear");
    // We translated for them, so it must not pass as something they chose.
    expect(resolved.source).toBe("synonym");
  });

  it("marks a real taxonomy word as exact rather than inferred", () => {
    expect(resolveText("Apparel").source).toBe("exact");
  });

  it("returns canonical casing, not the resolver's lowercase", () => {
    // The rollup keys on term and the match profile reads canonical labels —
    // two spellings of "Apparel" would silently split the same signal in half.
    expect(resolveText("hoodie").terms.every((t) => t !== t.toLowerCase())).toBe(true);
  });

  it("says nothing when the words map to nothing", () => {
    expect(resolveText("please send a rate card").terms).toEqual([]);
    expect(resolveText("").source).toBeNull();
  });

  it("reads a whole post body word by word", () => {
    const resolved = resolveDocument(
      "Does anyone have a supplier for grad gowns? Ours fell through and convocation is in May."
    );
    expect(resolved.terms).toContain("Graduation & Regalia");
    expect(resolved.terms).toContain("Caps & Gowns");
  });

  it("treats a category-named Circle space as a declaration", () => {
    const resolved = resolveSpaceName("Course Materials");
    expect(resolved.terms).toEqual(["Course Materials"]);
    expect(resolved.source).toBe("space");
  });

  it("refuses to guess at an off-taxonomy space name", () => {
    // "General Merchandise" is one of the legacy off-vocabulary values and is
    // genuinely ambiguous. 149 posts sit in it; auto-mapping is what produced
    // the legacy mess in the first place.
    expect(resolveSpaceName("General Merchandise").terms).toEqual([]);
    expect(resolveSpaceName("Say Hello").terms).toEqual([]);
  });

  it("records a filter click as the strongest term source", () => {
    expect(resolveCategoryClick("Activewear").source).toBe("category");
  });
});

describe("decay", () => {
  it("halves a search's weight after one half-life", () => {
    const fresh = decayedWeight("searched", NOW, NOW);
    const stale = decayedWeight("searched", daysAgo(VERB_PROFILES.searched.halfLifeDays), NOW);
    expect(stale).toBeCloseTo(fresh / 2, 5);
  });

  it("keeps a space join alive far longer than a search", () => {
    const search = decayedWeight("searched", daysAgo(365), NOW);
    const join = decayedWeight("joined", daysAgo(365), NOW);
    expect(join).toBeGreaterThan(search * 3);
  });

  it("makes a recent search outweigh a year-old one — the point of collecting it", () => {
    expect(decayedWeight("searched", daysAgo(7), NOW)).toBeGreaterThan(
      decayedWeight("searched", daysAgo(365), NOW)
    );
  });

  it("does not reward a future timestamp", () => {
    const skewed = decayedWeight("searched", new Date(NOW.getTime() + 86_400_000), NOW);
    expect(skewed).toBe(VERB_PROFILES.searched.weight);
  });

  it("ranks a written post above a glance", () => {
    expect(decayedWeight("posted", NOW, NOW)).toBeGreaterThan(decayedWeight("viewed", NOW, NOW));
    expect(decayedWeight("viewed", NOW, NOW)).toBeGreaterThan(decayedWeight("opened", NOW, NOW));
  });
});

describe("rollups", () => {
  it("⛔ keeps the person, because that resolution cannot be recovered later", () => {
    // Zach owns course materials and Karin owns apparel. Rolling up to org first
    // gives "McMaster buys both", which is the wrong answer to "who should Zach
    // meet" — and no later step can undo it.
    const rolled = rollupTerms(
      [
        event({ actorContactId: "person-1" }),
        event({ actorContactId: "person-2" }),
        event({ actorContactId: "person-1" }), // same person again
      ],
      NOW
    );

    expect(rolled).toHaveLength(2);
    expect(rolled.find((r) => r.contactId === "person-1")!.eventCount).toBe(2);
    expect(rolled.find((r) => r.contactId === "person-2")!.eventCount).toBe(1);
  });

  it("folds to org level on request, counting distinct people", () => {
    const org = collapseToOrg(
      rollupTerms(
        [
          event({ actorContactId: "person-1" }),
          event({ actorContactId: "person-2" }),
          event({ actorContactId: "person-1" }),
        ],
        NOW
      )
    );

    expect(org).toHaveLength(1);
    expect(org[0].contactId).toBeNull();
    expect(org[0].eventCount).toBe(3);
    // Two people, three events — a sum of per-bucket counts would say two.
    expect(org[0].actorCount).toBe(2);
  });

  it("still rolls up an act nobody can be attributed to", () => {
    const rolled = rollupTerms([event({ actorContactId: null })], NOW);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].contactId).toBeNull();
  });

  it("keeps a click and a translation apart rather than letting one inherit the other", () => {
    const rolled = rollupTerms(
      [
        event({ termSource: "category", terms: ["Activewear"] }),
        event({ termSource: "synonym", terms: ["Activewear"] }),
      ],
      NOW
    );
    expect(rolled).toHaveLength(2);
    expect(new Set(rolled.map((r) => r.termSource))).toEqual(new Set(["category", "synonym"]));
  });

  it("collapses to the best evidence per term, taking max actors not the sum", () => {
    const collapsed = bestPerTerm(
      rollupTerms(
        [
          event({ termSource: "synonym", actorContactId: "p1" }),
          event({ termSource: "category", actorContactId: "p1" }),
        ],
        NOW
      )
    );
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].termSource).toBe("category");
    // One person did both things — summing would invent a second.
    expect(collapsed[0].actorCount).toBe(1);
  });

  it("drops a term that has decayed into noise", () => {
    const ancient = rollupTerms([event({ verb: "viewed", occurredAt: daysAgo(3000) })], NOW);
    expect(ancient).toEqual([]);
  });

  it("builds org-to-org affinity and ignores an org visiting itself", () => {
    const rolled = rollupAffinity(
      [
        event({ verb: "viewed", objectType: "org", objectOrgId: "org-b", terms: [] }),
        event({ verb: "clicked", objectType: "org", objectOrgId: "org-b", terms: [] }),
        event({ verb: "viewed", objectType: "org", objectOrgId: "org-a", terms: [] }), // self
      ],
      NOW
    );
    expect(rolled).toHaveLength(1);
    expect(rolled[0].objectOrgId).toBe("org-b");
    expect(rolled[0].eventCount).toBe(2);
  });

  it("normalises against the org's own strongest term, not across orgs", () => {
    // A fifteen-person store out-browses a two-person shop at everything;
    // ranking on raw totals would just rank by headcount.
    const busy = Array.from({ length: 20 }, () => event({ actorOrgId: "big", terms: ["Activewear"] }));
    const quiet = [event({ actorOrgId: "small", terms: ["Activewear"] })];
    const normalized = normalizeTermWeights(rollupTerms([...busy, ...quiet], NOW));
    expect(normalized.get(termKey("big", "Activewear"))).toBeCloseTo(1);
    expect(normalized.get(termKey("small", "Activewear"))).toBeCloseTo(1);
  });
});

describe("explicit preference from the conference module", () => {
  it("never blends a declared refusal into implicit browsing", () => {
    // The conference module emits refusals, top-5 picks and swap behaviour.
    // A store can browse a vendor often AND have refused them — a stale grudge,
    // or checking up on someone. Netting those to one number destroys both facts.
    const rolled = rollupAffinity(
      [
        event({ verb: "viewed", objectOrgId: "vendor", terms: [], objectType: "org" }),
        event({ verb: "viewed", objectOrgId: "vendor", terms: [], objectType: "org" }),
        event({
          verb: "refused",
          objectOrgId: "vendor",
          objectType: "org",
          terms: [],
          stance: "explicit",
          polarity: "negative",
          weight: VERB_PROFILES.refused.weight,
        }),
      ],
      NOW
    );

    expect(rolled).toHaveLength(2);
    const refusal = rolled.find((r) => r.polarity === "negative")!;
    const browsing = rolled.find((r) => r.polarity === "positive")!;
    expect(refusal.stance).toBe("explicit");
    expect(refusal.eventCount).toBe(1);
    expect(browsing.stance).toBe("implicit");
    expect(browsing.eventCount).toBe(2);
  });

  it("weighs a refusal far above anything someone merely did", () => {
    expect(decayedWeight("refused", NOW, NOW)).toBeGreaterThan(decayedWeight("viewed", NOW, NOW) * 5);
    // Passing something over is confounded; choosing it is not.
    expect(decayedWeight("selected", NOW, NOW)).toBeGreaterThan(decayedWeight("rejected", NOW, NOW));
  });

  it("does not let a refusal set the ceiling that positive interest is scaled against", () => {
    const rolled = rollupTerms(
      [
        event({ terms: ["Activewear"] }),
        event({
          verb: "refused",
          terms: ["Activewear"],
          stance: "explicit",
          polarity: "negative",
          weight: VERB_PROFILES.refused.weight,
        }),
      ],
      NOW
    );
    const normalized = normalizeTermWeights(rolled);
    // Scaled against the org's strongest POSITIVE term, so genuine interest
    // still reads as 1 rather than being crushed by the heaviest negative.
    expect(normalized.get(termKey("org-a", "Activewear"))).toBeCloseTo(1);
  });

  it("keeps explicit and implicit apart when collapsing term sources", () => {
    const collapsed = bestPerTerm(
      rollupTerms(
        [
          event({ termSource: "synonym" }),
          event({ termSource: "category" }),
          event({
            verb: "rejected",
            termSource: "category",
            stance: "explicit",
            polarity: "negative",
          }),
        ],
        NOW
      )
    );
    // Two implicit sources merge into one row; the explicit negative stays its own.
    expect(collapsed).toHaveLength(2);
    expect(collapsed.filter((r) => r.stance === "explicit")).toHaveLength(1);
  });
});

describe("composite keys", () => {
  it("does not collide for terms containing spaces", () => {
    // "Course Materials" contains a space, so a space-joined key would let
    // (org "a b", term "c") and (org "a", term "b c") land in the same bucket.
    expect(termKey("a b", "Course Materials")).not.toBe(termKey("a", "b Course Materials"));
  });
});

describe("disclosure — aggregates that cannot name anyone", () => {
  it("bands a count below the cohort floor", () => {
    const one = bandCount(1);
    expect(one.exact).toBeNull();
    expect(one.banded).toBe(true);
    expect(one.label).toBe(`fewer than ${MIN_DISCLOSURE_COHORT} stores`);
  });

  it("states a count at or above the floor", () => {
    expect(bandCount(8).exact).toBe(8);
    expect(bandCount(8).label).toBe("8 stores");
  });

  it("states zero plainly, so an empty result is not mistaken for a hidden one", () => {
    expect(bandCount(0).exact).toBe(0);
    expect(bandCount(0).banded).toBe(false);
  });

  it("summarises impressions without emitting a single identity", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      surface: i % 3 === 0 ? "explore" : "member_suppliers",
      subjectOrgId: `store-${i % 8}`,
      viewerContactId: `person-${i}`,
      rank: (i % 10) + 1,
      contextTerms: ["Activewear"],
    }));

    const summary = summarizeImpressions(rows);
    expect(summary.appearances).toBe(12);
    expect(summary.distinctViewerOrgs.exact).toBe(8);
    expect(summary.topContextTerms[0].term).toBe("Activewear");
    expect(summary.bestRank).toBe(1);

    // Nothing in the output can carry a person or an org identity.
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("person-");
    expect(serialized).not.toContain("store-");
  });

  it("bands the viewer count when only one store looked", () => {
    const summary = summarizeImpressions([
      { surface: "explore", subjectOrgId: "store-1", viewerContactId: "p1", rank: 3, contextTerms: [] },
      { surface: "explore", subjectOrgId: "store-1", viewerContactId: "p1", rank: 4, contextTerms: [] },
    ]);
    expect(summary.appearances).toBe(2);
    expect(summary.distinctViewerOrgs.exact).toBeNull();
    expect(describeImpressions(summary)).toContain("fewer than 5 stores");
  });

  it("says so plainly when a listing never appeared", () => {
    expect(describeImpressions(summarizeImpressions([]))).toContain("not appeared");
  });

  it("bands only what is disclosed — the underlying counts stay whole", () => {
    // ⚠️ The floor is a DISCLOSURE rule, not a knowledge rule. Internally the
    // engine keeps every event at full fidelity; banding happens at the moment
    // of telling someone, and nowhere earlier.
    const rows = [
      { surface: "explore", subjectOrgId: "store-1", viewerContactId: "p1", rank: 2, contextTerms: ["Books"] },
      { surface: "explore", subjectOrgId: "store-2", viewerContactId: "p2", rank: 5, contextTerms: ["Books"] },
    ];
    const summary = summarizeImpressions(rows);
    // Told outward: banded.
    expect(summary.distinctViewerOrgs.exact).toBeNull();
    // Known internally: exact, and still usable for ranking and for conference matching.
    expect(summary.appearances).toBe(2);
    expect(summary.topContextTerms[0]).toEqual({ term: "Books", appearances: 2 });
  });
});


describe("the world does not hold still", () => {
  it("keeps an act whose words the vocabulary cannot name", () => {
    // Nine of twelve realistic campus-store queries resolve to nothing today.
    // "crewneck" is apparel; "inclusive access" is a column in the benchmarking
    // table. Dropping them would admit only signal we can already name.
    const resolved = resolveText("crewneck");
    expect(resolved.terms).toEqual([]);

    const kept = event({ terms: [], termSource: null, rawText: "crewneck" });
    expect(kept.rawText).toBe("crewneck");
  });

  it("ranks unresolved demand by how many orgs asked, not how loudly one did", () => {
    const demand = unresolvedDemand([
      // One store, many times.
      ...Array.from({ length: 15 }, () =>
        event({ terms: [], termSource: null, rawText: "shrink wrap machine", actorOrgId: "loud" })),
      // Three stores, once each — a trend, not a person.
      event({ terms: [], termSource: null, rawText: "inclusive access", actorOrgId: "a" }),
      event({ terms: [], termSource: null, rawText: "Inclusive Access ", actorOrgId: "b" }),
      event({ terms: [], termSource: null, rawText: "inclusive  access", actorOrgId: "c" }),
      // Already resolved — not a gap in the vocabulary.
      event({ terms: ["Apparel"], rawText: "hoodies", actorOrgId: "d" }),
    ]);

    expect(demand[0].text).toBe("inclusive access");
    expect(demand[0].orgCount).toBe(3);
    expect(demand.some((d) => d.text === "hoodies")).toBe(false);
    // Casing and whitespace variants are the same demand.
    expect(demand.filter((d) => d.text === "inclusive access")).toHaveLength(1);
  });

  it("finds events read by an older vocabulary so they can be re-read", () => {
    const stale = staleResolutions(
      [
        event({ rawText: "hoodies", resolverVersion: "old.0" }),
        event({ rawText: "hoodies", resolverVersion: RESOLVER_VERSION }),
        // No raw text — nothing to re-resolve from, so not stale, just done.
        event({ rawText: null, terms: [], termSource: null, objectOrgId: "x", resolverVersion: "old.0" }),
      ],
      RESOLVER_VERSION
    );
    expect(stale).toHaveLength(1);
    expect(needsReresolution("old.0")).toBe(true);
    expect(needsReresolution(RESOLVER_VERSION)).toBe(false);
  });

  it("changes the resolver version when the taxonomy changes", () => {
    // The taxonomy half is a fingerprint, so it cannot be forgotten.
    expect(RESOLVER_VERSION).toMatch(/^[a-z0-9]+\.\d+$/);
  });
});
