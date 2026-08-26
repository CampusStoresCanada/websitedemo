import { describe, it, expect } from "vitest";
import {
  buildResultsAnnouncement,
  type ResultsAnnouncementInput,
} from "../documents/results-announcement";

/**
 * By-Law Part V S3(d)–(e) splits announcing from electing: the Chair announces
 * the ballot result at the AGM, and the MEMBERS then elect. The wording has to
 * carry that, and it has to not thank a director for their service in the same
 * message that announces their re-election.
 */

function input(over: Partial<ResultsAnnouncementInput> = {}): ResultsAnnouncementInput {
  return {
    cycleYear: 2027,
    agmDate: "2027-01-21",
    outcome: "balloted",
    elected: [
      { name: "Shannon Blackadder", institution: "Mount Royal University" },
      { name: "Jason Kack", institution: "University of Alberta" },
    ],
    continuing: [{ name: "Trish Linden-Teasdale", institution: "Georgian College" }],
    departing: [{ name: "Pat Example", institution: "Example College" }],
    ballotsReturned: 31,
    electorateSize: 52,
    termEndsYear: 2029,
    ...over,
  };
}

describe("buildResultsAnnouncement — who did the electing", () => {
  it("says the MEMBERS elected them, not the ballot", () => {
    const a = buildResultsAnnouncement(input());
    expect(a.paragraphs[0]).toMatch(/the members elected/i);
    expect(a.paragraphs[0]).toMatch(/annual general meeting on January 21, 2027/);
  });

  it("credits the Chair with announcing, per S3(d)", () => {
    const a = buildResultsAnnouncement(input());
    expect(a.paragraphs[0]).toMatch(/Chair of the Nominating Committee/);
  });

  it("writes in the past tense of a meeting that has happened", () => {
    // Sent before the AGM this would be false — the members had not yet elected.
    const a = buildResultsAnnouncement(input());
    expect(a.paragraphs[0]).not.toMatch(/will be|are being|is scheduled/i);
  });

  it("says acclamation without inventing a ballot", () => {
    const a = buildResultsAnnouncement(input({ outcome: "acclaimed", ballotsReturned: null }));
    expect(a.paragraphs[0]).toMatch(/by acclamation/);
    expect(a.paragraphs[0]).toMatch(/no ballot was required/i);
    expect(a.subject).toMatch(/acclamation/);
  });
});

describe("buildResultsAnnouncement — the departing-director trap", () => {
  it("thanks only those who actually left", () => {
    const a = buildResultsAnnouncement(input());
    expect(a.html).toMatch(/thanks .*Pat Example/);
  });

  it("says nothing about departures when nobody left", () => {
    // A director completing a term and standing again is NOT departing. The
    // caller filters them out; this checks the sentence disappears entirely
    // rather than rendering an empty thank-you.
    const a = buildResultsAnnouncement(input({ departing: [] }));
    expect(a.html).not.toMatch(/concluded at this meeting/);
    // The closing "our thanks to everyone who stood" is a different sentence and
    // should survive — this is about the departure tribute, not gratitude.
    expect(a.html).toMatch(/thanks to everyone who stood/);
  });

  it("never names an elected director as departing", () => {
    const a = buildResultsAnnouncement(input());
    const thanksParagraph = a.paragraphs.find((p) => /concluded at this meeting/.test(p)) ?? "";
    for (const d of input().elected) {
      expect(thanksParagraph).not.toContain(d.name);
    }
  });
});

describe("buildResultsAnnouncement — what it does and does not publish", () => {
  it("publishes turnout, which describes the membership", () => {
    const a = buildResultsAnnouncement(input());
    expect(a.html).toMatch(/31 of 52 member institutions/);
    expect(a.html).toMatch(/turnout of 60%/);
  });

  it("never publishes vote counts or a ranking", () => {
    // The by-law asks the Chair to announce the result at the meeting. It does
    // not ask the association to mail every store a league table.
    const a = buildResultsAnnouncement(input());
    expect(a.html).not.toMatch(/\bvotes\b/i);
    expect(a.html).not.toMatch(/received \d+/);
  });

  it("omits turnout entirely when acclaimed", () => {
    const a = buildResultsAnnouncement(
      input({ outcome: "acclaimed", ballotsReturned: null, electorateSize: 52 })
    );
    expect(a.html).not.toMatch(/turnout/);
  });

  it("states when the new terms end", () => {
    const a = buildResultsAnnouncement(input());
    expect(a.html).toMatch(/two-year terms run to the annual general meeting in 2029/);
  });

  it("escapes institution names rather than trusting them", () => {
    const a = buildResultsAnnouncement(
      input({ elected: [{ name: "A & B", institution: "<script>x</script>" }] })
    );
    expect(a.html).toContain("A &amp; B");
    expect(a.html).not.toContain("<script>");
  });
});

describe("buildResultsAnnouncement — refusing to say nothing", () => {
  it("flags an announcement with nobody elected", () => {
    const a = buildResultsAnnouncement(input({ elected: [] }));
    expect(a.outstanding).toContain("Nobody is recorded as elected — do not send this.");
  });
});
