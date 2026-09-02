import { describe, expect, it } from "vitest";
import { validateSignalEvent, requireValidSignalEvent, assertNotEngineCaused } from "../ingest";
import type { SignalEvent } from "../types";

const NOW = new Date("2026-08-31T12:00:00Z");

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
    rawText: "hoodies",
    terms: ["Apparel", "Activewear"],
    termSource: "synonym",
    resolverVersion: "test.1",
    weight: 3,
    dedupeKey: null,
    ...overrides,
  };
}

const problemsOf = (e: SignalEvent) => validateSignalEvent(e, NOW).problems.join(" | ");

describe("the eight questions", () => {
  it("accepts a well-formed search", () => {
    expect(validateSignalEvent(event(), NOW).ok).toBe(true);
  });

  it("⛔ KEEPS an act nobody can be attributed to", () => {
    // Every act by a human is signal. An anonymous search is still someone
    // asking for something, it just cannot feed a profile — and the rollups
    // skip null-actor rows anyway, so it costs the scoring nothing.
    expect(validateSignalEvent(event({ actorOrgId: null, actorContactId: null }), NOW).ok).toBe(true);
  });

  it("⛔ KEEPS an act whose words resolved to nothing", () => {
    // The taxonomy names ~13 departments and ~60 classes; people search for
    // things it has never heard of. Nine of twelve realistic campus-store
    // queries resolve to nothing — "crewneck", "inclusive access", "OER
    // integration". Requiring resolution would admit only signal we can already
    // name, which is the opposite of storing the act.
    const unresolved = event({ terms: [], termSource: null, objectOrgId: null, rawText: "crewneck" });
    expect(validateSignalEvent(unresolved, NOW).ok).toBe(true);
  });

  it("refuses only an event with no terms, no org AND no raw text", () => {
    // Nothing to score now, nothing to re-resolve later — that is telemetry.
    expect(problemsOf(event({ terms: [], termSource: null, objectOrgId: null, rawText: null })))
      .toContain("telemetry");
  });

  it("refuses terms whose resolution route was not recorded", () => {
    expect(problemsOf(event({ termSource: null }))).toContain("termSource");
  });

  it("refuses an org acting on itself", () => {
    expect(problemsOf(event({ objectOrgId: "org-a", objectType: "org" }))).toContain("not an affinity");
  });
});

describe("explicit and implicit cannot be mislabelled at the source", () => {
  it("requires a declaration verb to carry explicit stance", () => {
    expect(problemsOf(event({ verb: "refused", polarity: "negative", stance: "implicit" })))
      .toContain('must carry stance "explicit"');
  });

  it("refuses to let a mere act claim to be a declaration", () => {
    expect(problemsOf(event({ verb: "viewed", stance: "explicit" }))).toContain("needs its own verb");
  });

  it("⛔ refuses implicit negative — absence is not a statement", () => {
    // Not clicking something is not dislike. There is no implicit-negative.
    expect(problemsOf(event({ verb: "viewed", polarity: "negative" })))
      .toContain("reading absence as a statement");
  });

  it("accepts a properly declared refusal", () => {
    const refusal = event({
      source: "conference",
      verb: "refused",
      stance: "explicit",
      polarity: "negative",
      objectType: "org",
      objectOrgId: "vendor",
      terms: [],
      termSource: null,
      rawText: "failed to deliver in 2012",
      dedupeKey: "refusal:org-a:vendor:2026-01-01",
      weight: 10,
    });
    expect(validateSignalEvent(refusal, NOW).ok).toBe(true);
  });
});

describe("the interpretation must stay repeatable", () => {
  it("refuses resolved terms whose raw text was thrown away", () => {
    // A better resolver can never be applied to a row that kept only conclusions.
    expect(problemsOf(event({ rawText: null }))).toContain("unrepeatable");
  });

  it("allows a space or filter resolution with no raw text — the label IS the raw form", () => {
    expect(validateSignalEvent(
      event({ verb: "joined", source: "circle", termSource: "space", rawText: null,
              dedupeKey: "circle:space_member:1:2" }), NOW).ok).toBe(true);
  });
});

describe("replay safety and time", () => {
  it("requires a dedupe key on a source that can be re-run", () => {
    // Re-syncing Circle's 870 posts without one silently doubles every weight.
    expect(problemsOf(event({ source: "circle", verb: "posted", dedupeKey: null })))
      .toContain("dedupeKey");
  });

  it("does not demand one from the live website", () => {
    expect(validateSignalEvent(event({ source: "website", dedupeKey: null }), NOW).ok).toBe(true);
  });

  it("refuses ingestion time masquerading as the act's time", () => {
    // A backfill stamped "today" turns fourteen months of history into one day.
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(problemsOf(event({ occurredAt: future }))).toContain("not ingestion time");
  });
});

describe("⛔ the engine must not eat its own output", () => {
  it("refuses an act the solver caused", () => {
    expect(() => assertNotEngineCaused(true, "scheduler-generated meeting")).toThrow(
      /reinforce its own recommendations/
    );
  });

  it("allows the human act that followed it", () => {
    expect(() => assertNotEngineCaused(false, "delegate swapped out of the meeting")).not.toThrow();
  });
});

describe("requireValidSignalEvent", () => {
  it("names every problem at once rather than one per run", () => {
    expect(() =>
      requireValidSignalEvent(
        event({ rawText: null, verb: "viewed", polarity: "negative", stance: "explicit" }),
        NOW
      )
    ).toThrow(/needs its own verb[\s\S]*reading absence as a statement/);
  });
});
