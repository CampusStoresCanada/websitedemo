import { describe, expect, it } from "vitest";
import { retentionFor, planRetention, scoringHorizonDays } from "../retention";
import { VERB_PROFILES } from "../decay";
import type { SignalEvent } from "../types";

const NOW = new Date("2026-08-31T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function event(overrides: Partial<SignalEvent> = {}): SignalEvent {
  return {
    occurredAt: NOW, source: "website", verb: "searched",
    actorOrgId: "org-a", actorContactId: "person-1",
    stance: "implicit", polarity: "positive",
    objectType: "query", objectOrgId: null, objectRef: null,
    rawText: "hoodies", terms: ["Apparel"], termSource: "synonym",
    resolverVersion: "test.1", weight: 3, dedupeKey: null,
    ...overrides,
  };
}

describe("retention is decay read backwards", () => {
  it("derives the horizon from the verb's own weight and half-life", () => {
    // Nothing hardcoded: change a half-life and retention follows, so the two
    // can never disagree.
    const searched = scoringHorizonDays("searched");
    expect(searched).toBeGreaterThan(VERB_PROFILES.searched.halfLifeDays * 5);
    // A glance goes stale far sooner than a position someone holds.
    expect(scoringHorizonDays("viewed")).toBeLessThan(scoringHorizonDays("joined"));
  });

  it("keeps an event that is still scoring", () => {
    expect(retentionFor(event({ occurredAt: daysAgo(30) }), NOW).action).toBe("keep");
  });

  it("⛔ drops the person before the text", () => {
    // actor_contact_id is the sensitive half and the least useful over time.
    // raw_text is what makes an old event re-resolvable and is a search string
    // attached to an org, not to a person.
    const aged = retentionFor(event({ occurredAt: daysAgo(700) }), NOW);
    expect(aged.action).toBe("depersonalize");
    expect(aged.why).toContain("re-resolving");
  });

  it("only deletes once the text has no re-resolution value left either", () => {
    expect(retentionFor(event({ occurredAt: daysAgo(3000) }), NOW).action).toBe("delete");
  });

  it("keeps an aged event that has nothing left to depersonalise", () => {
    const anon = retentionFor(event({ occurredAt: daysAgo(700), actorContactId: null }), NOW);
    expect(anon.action).toBe("keep");
  });

  it("never deletes a declaration, however old", () => {
    // Few of them, highest-value training signal, and deleting someone's
    // declared refusal because it got old would be absurd.
    const ancient = event({
      occurredAt: daysAgo(20_000),
      verb: "refused", stance: "explicit", polarity: "negative",
      objectType: "org", objectOrgId: "vendor",
      terms: [], termSource: null, rawText: "failed to deliver",
      weight: VERB_PROFILES.refused.weight,
    });
    expect(retentionFor(ancient, NOW).action).toBe("depersonalize");
    expect(retentionFor({ ...ancient, actorContactId: null }, NOW).action).toBe("keep");
  });
});

describe("the plan is previewable, and states itself in days", () => {
  it("counts what a pass would do before it does it", () => {
    const plan = planRetention(
      [
        event({ occurredAt: daysAgo(10) }),
        event({ occurredAt: daysAgo(700) }),
        event({ occurredAt: daysAgo(3000) }),
      ],
      NOW
    );
    expect(plan).toMatchObject({ keep: 1, depersonalize: 1, delete: 1 });
  });

  it("reports horizons as numbers a privacy notice can quote", () => {
    const { horizons } = planRetention([], NOW);
    const searched = horizons.find((h) => h.verb === "searched")!;
    expect(searched.scoringDays).toBeGreaterThan(0);
    // Declarations are kept indefinitely, and the plan says so rather than
    // implying a horizon that does not exist.
    expect(horizons.find((h) => h.verb === "refused")!.textDays).toBe(Infinity);
  });
});
