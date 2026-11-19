import { describe, it, expect } from "vitest";
import {
  MEMBERS_MEETING_DESCRIPTIONS,
  MEMBERS_MEETING_LABELS,
  MEMBERS_MEETING_TYPES,
  agmEventSlug,
  compareMembersMeetings,
  membersMeetingEventSlug,
  membersMeetingTitle,
  instantAtMeetingZone,
  isMembersMeetingType,
  meetingDateOf,
  meetingDivergence,
  membersMeetingGaps,
  type MembersMeeting,
  venueOf,
  wallTimeAtMeetingZone,
} from "@/lib/governance/members-meetings";

function meeting(over: Partial<MembersMeeting> = {}): MembersMeeting {
  return {
    id: "m1",
    meetingDate: "2027-01-21",
    meetingType: "agm",
    title: "CSC Annual General Meeting — 2027-01-21",
    status: "upcoming",
    notes: null,
    purpose: null,
    hasAgenda: false,
    hasMinutes: false,
    documentCount: 0,
    proxyCount: 0,
    noticeSentAt: null,
    proxyFormSentAt: null,
    packageSentAt: null,
    packageSendCount: 0,
    event: {
      id: "e1",
      slug: "csc-annual-general-meeting-2027",
      status: "published",
      startsAt: "2027-01-21T16:00:00",
      endsAt: "2027-01-21T18:00:00",
      isVirtual: true,
      location: null,
      virtualLink: "https://meet.example/agm",
      audienceMode: "members",
      googleEventId: "g1",
    },
    election: null,
    ...over,
  };
}

describe("which meetings are members' meetings", () => {
  it("counts the AGM", () => {
    expect(isMembersMeetingType("agm")).toBe(true);
  });

  it("does NOT count a special board meeting", () => {
    // `special` already means a special meeting of the BOARD in
    // POST /api/admin/board/meetings. Reading it as a members' meeting too
    // would put board business on the members' list.
    expect(isMembersMeetingType("special")).toBe(false);
    expect(isMembersMeetingType("regular")).toBe(false);
  });

  it("labels every type it claims", () => {
    for (const type of MEMBERS_MEETING_TYPES) {
      expect(MEMBERS_MEETING_LABELS[type]).toBeTruthy();
    }
  });
});

describe("agmEventSlug", () => {
  it("matches the slug the AGM notice looks up", () => {
    // Spelled out literally in sendAgmNotice before this function existed; the
    // notice refuses to send unless an event at this exact slug is published.
    expect(agmEventSlug(2027)).toBe("csc-annual-general-meeting-2027");
  });
});

describe("venueOf", () => {
  it("is online-only when virtual with no address", () => {
    expect(venueOf({ isVirtual: true, location: null })).toBe("virtual");
  });

  it("is in person when not virtual", () => {
    expect(venueOf({ isVirtual: false, location: "Hotel, Calgary" })).toBe("in_person");
  });

  it("is hybrid when it is both", () => {
    expect(venueOf({ isVirtual: true, location: "Hotel, Calgary" })).toBe("hybrid");
  });

  it("treats a blank address as no address", () => {
    expect(venueOf({ isVirtual: true, location: "   " })).toBe("virtual");
  });
});

describe("membersMeetingGaps", () => {
  it("is empty for a published meeting with a time and a link", () => {
    expect(membersMeetingGaps(meeting())).toEqual([]);
  });

  it("says so when there is no event page", () => {
    const gaps = membersMeetingGaps(meeting({ event: null }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("no event page");
  });

  it("flags a draft event, because notice would link to nothing", () => {
    const gaps = membersMeetingGaps(
      meeting({ event: { ...meeting().event!, status: "draft" } })
    );
    expect(gaps.some((g) => g.includes("draft"))).toBe(true);
  });

  it("flags a missing start time", () => {
    const gaps = membersMeetingGaps(
      meeting({ event: { ...meeting().event!, startsAt: null } })
    );
    expect(gaps.some((g) => g.includes("start time"))).toBe(true);
  });

  it("flags an in-person meeting with no address", () => {
    const gaps = membersMeetingGaps(
      meeting({
        event: { ...meeting().event!, isVirtual: false, location: null, virtualLink: null },
      })
    );
    expect(gaps.some((g) => g.includes("address"))).toBe(true);
  });

  it("does not demand a joining link for an in-person meeting", () => {
    const gaps = membersMeetingGaps(
      meeting({
        event: {
          ...meeting().event!,
          isVirtual: false,
          location: "Hotel, Calgary",
          virtualLink: null,
          googleEventId: null,
        },
      })
    );
    expect(gaps).toEqual([]);
  });

  it("accepts a minted Google event in place of a typed link", () => {
    const gaps = membersMeetingGaps(
      meeting({ event: { ...meeting().event!, virtualLink: null, googleEventId: "g1" } })
    );
    expect(gaps).toEqual([]);
  });

  it("reports nothing outstanding for a cancelled meeting", () => {
    expect(membersMeetingGaps(meeting({ status: "cancelled", event: null }))).toEqual([]);
  });
});

// ─── The date a meeting sits on, in the zone it is called in ────────────────
//
// These matter because the election joins to the meeting on `meeting_date`
// with no foreign key. Deriving that date in the wrong zone puts the meeting
// on the wrong day and silently unhooks it from its own election.

describe("meetingDateOf", () => {
  it("reads the Eastern calendar day, not the UTC one", () => {
    // 2027-01-21 17:00Z is noon Eastern on the 21st — the real 2027 AGM.
    expect(meetingDateOf("2027-01-21T17:00:00Z")).toBe("2027-01-21");
  });

  it("keeps an evening Eastern meeting on its own day", () => {
    // 7 p.m. Eastern on the 21st is 00:00Z on the 22nd. Taking the UTC date
    // would file the meeting a day late.
    expect(meetingDateOf("2027-01-22T00:00:00Z")).toBe("2027-01-21");
  });

  it("accepts a Supabase timestamp with no zone marker", () => {
    // `timestamp without time zone` comes back as "YYYY-MM-DD HH:mm:ss".
    expect(meetingDateOf("2027-01-21 17:00:00")).toBe("2027-01-21");
  });

  it("returns null for something that is not a timestamp", () => {
    expect(meetingDateOf("not a date")).toBeNull();
  });
});

describe("wallTimeAtMeetingZone", () => {
  it("gives the hour the board set, in Eastern", () => {
    expect(wallTimeAtMeetingZone("2027-01-21T17:00:00Z")).toBe("12:00");
  });

  it("accounts for daylight time in summer", () => {
    // July is EDT (UTC-4), so 16:00Z is noon, not 11:00.
    expect(wallTimeAtMeetingZone("2027-07-21T16:00:00Z")).toBe("12:00");
  });
});

describe("instantAtMeetingZone", () => {
  it("round-trips a winter meeting", () => {
    const iso = instantAtMeetingZone("2027-01-21", "12:00");
    expect(iso).toBe("2027-01-21T17:00:00.000Z");
    expect(meetingDateOf(iso!)).toBe("2027-01-21");
    expect(wallTimeAtMeetingZone(iso!)).toBe("12:00");
  });

  it("round-trips a summer meeting at the other offset", () => {
    // ⛔ The offset is NOT fixed. Assuming -5 year-round would put this an
    // hour out, which is exactly the bug this helper exists to avoid.
    const iso = instantAtMeetingZone("2027-07-21", "12:00");
    expect(iso).toBe("2027-07-21T16:00:00.000Z");
    expect(wallTimeAtMeetingZone(iso!)).toBe("12:00");
  });

  it("preserves the hour when a meeting moves across the DST boundary", () => {
    // Moving a noon-Eastern meeting from January to July must stay noon
    // Eastern — not shift by the offset difference.
    const winter = instantAtMeetingZone("2027-01-21", "12:00")!;
    const moved = instantAtMeetingZone("2027-07-21", wallTimeAtMeetingZone(winter)!)!;
    expect(wallTimeAtMeetingZone(moved)).toBe("12:00");
    expect(winter).not.toBe(moved);
  });

  it("keeps an evening meeting on the day it was called for", () => {
    const iso = instantAtMeetingZone("2027-01-21", "19:00")!;
    expect(iso).toBe("2027-01-22T00:00:00.000Z");
    expect(meetingDateOf(iso)).toBe("2027-01-21");
  });

  it("refuses a wall time that does not exist on that day", () => {
    // 02:30 on the spring-forward morning never happens in Eastern.
    expect(instantAtMeetingZone("2027-03-14", "02:30")).toBeNull();
  });

  it("refuses malformed input rather than guessing", () => {
    expect(instantAtMeetingZone("2027-1-21", "12:00")).toBeNull();
    expect(instantAtMeetingZone("2027-01-21", "noon")).toBeNull();
  });
});

// ─── A special meeting OF THE MEMBERS ───────────────────────────────────────

describe("special meetings of the members", () => {
  it("is a members' meeting type", () => {
    expect(isMembersMeetingType("special_members")).toBe(true);
    expect(MEMBERS_MEETING_LABELS.special_members).toBe("Special Meeting of the Members");
  });

  it("⛔ keeps 'special' OUT — that is a special meeting of the BOARD", () => {
    // Reading one value as two kinds of meeting is how the AGM got lost in the
    // board meeting list. The members' one is spelled `special_members`.
    expect(isMembersMeetingType("special")).toBe(false);
    expect(MEMBERS_MEETING_TYPES).not.toContain("special");
  });

  it("gives the AGM its load-bearing per-year slug, unchanged", () => {
    // sendAgmNotice looks the event up by this literal and puts it inside the
    // notice it sends, so it must not drift.
    expect(membersMeetingEventSlug("agm", "2027-01-21")).toBe(
      "csc-annual-general-meeting-2027"
    );
    expect(membersMeetingEventSlug("agm", "2027-01-21")).toBe(agmEventSlug(2027));
  });

  it("keys a special meeting by DATE, because two could fall in one year", () => {
    // `events.slug` is unique, so a per-year slug would collide on the second.
    expect(membersMeetingEventSlug("special_members", "2027-06-04")).toBe(
      "csc-special-members-meeting-2027-06-04"
    );
    expect(membersMeetingEventSlug("special_members", "2027-06-04")).not.toBe(
      membersMeetingEventSlug("special_members", "2027-11-12")
    );
  });

  it("titles each kind for what it is", () => {
    expect(membersMeetingTitle("agm", "2027-01-21")).toBe(
      "CSC Annual General Meeting — 2027-01-21"
    );
    expect(membersMeetingTitle("special_members", "2027-06-04")).toBe(
      "CSC Special Meeting of the Members — 2027-06-04"
    );
  });

  it("every type has a label and a description, or the picker renders a blank", () => {
    for (const t of MEMBERS_MEETING_TYPES) {
      expect(MEMBERS_MEETING_LABELS[t]?.length).toBeGreaterThan(0);
      expect(MEMBERS_MEETING_DESCRIPTIONS[t]?.length).toBeGreaterThan(0);
    }
  });
});

// ─── Divergence between a meeting and its election ──────────────────────────

describe("meetingDivergence", () => {
  it("says nothing when the dates agree, which is the normal case", () => {
    expect(
      meetingDivergence({
        meetingDate: "2027-01-21",
        election: { cycleYear: 2027, windowsDerivedFrom: "2027-01-21" },
      })
    ).toBeNull();
  });

  it("says nothing when there is no election", () => {
    expect(meetingDivergence({ meetingDate: "2027-01-21", election: null })).toBeNull();
  });

  it("says nothing when the election has NO windows yet", () => {
    // An election in setup has no calendar at all, so there is nothing for the
    // meeting to be out of step WITH. Saying "every date below is wrong" about
    // an election that has no dates would be noise in the one place that has to
    // stay loud for the real case.
    expect(
      meetingDivergence({
        meetingDate: "2027-01-21",
        election: { cycleYear: 2027, windowsDerivedFrom: null },
      })
    ).toBeNull();
  });

  it("reports BOTH dates when the meeting has moved", () => {
    // The whole point: while the date match was the only link this was silence,
    // indistinguishable from "no election for this meeting".
    const msg = meetingDivergence({
      meetingDate: "2027-02-04",
      election: { cycleYear: 2027, windowsDerivedFrom: "2027-01-21" },
    });
    expect(msg).toContain("2027-02-04");
    expect(msg).toContain("2027-01-21");
    expect(msg).toMatch(/notice may\s+already have been given/);
  });
});

describe("a special meeting needs its business stated", () => {
  const special = (over: Partial<MembersMeeting> = {}): MembersMeeting =>
    meeting({ meetingType: "special_members", ...over });

  it("⛔ asks for the business when a special meeting has none", () => {
    // Part VII: only what the notice says may be transacted. A notice with
    // nothing in it discharges the obligation while permitting nothing.
    expect(membersMeetingGaps(special({ purpose: null })).join(" ")).toMatch(
      /No business is stated/
    );
  });

  it("stops asking once it is written", () => {
    expect(
      membersMeetingGaps(special({ purpose: "To approve the sale of the Guelph warehouse." }))
        .join(" ")
    ).not.toMatch(/No business is stated/);
  });

  it("treats whitespace as unstated", () => {
    expect(membersMeetingGaps(special({ purpose: "   " })).join(" ")).toMatch(
      /No business is stated/
    );
  });

  it("does NOT ask it of an AGM — the by-law fixes that business", () => {
    expect(membersMeetingGaps(meeting({ purpose: null })).join(" ")).not.toMatch(
      /No business is stated/
    );
  });
});

describe("compareMembersMeetings", () => {
  const at = (date: string, type: string) =>
    meeting({ meetingDate: date, meetingType: type });

  it("puts the AGM before a special meeting, whatever the dates say", () => {
    // ⛔ Not chronological first: the AGM is what somebody opening the section
    // came to find, and in most years the only meeting there is.
    const list = [at("2027-03-01", "special_members"), at("2027-06-01", "agm")];
    expect(list.sort(compareMembersMeetings).map((m) => m.meetingType)).toEqual([
      "agm",
      "special_members",
    ]);
  });

  it("orders by date within a kind", () => {
    const list = [at("2028-01-20", "agm"), at("2027-01-21", "agm")];
    expect(list.sort(compareMembersMeetings).map((m) => m.meetingDate)).toEqual([
      "2027-01-21",
      "2028-01-20",
    ]);
  });

  it("is a stable total order over a mixed list", () => {
    const list = [
      at("2027-09-09", "special_members"),
      at("2028-01-20", "agm"),
      at("2027-03-01", "special_members"),
      at("2027-01-21", "agm"),
    ];
    expect(
      list.sort(compareMembersMeetings).map((m) => `${m.meetingType}:${m.meetingDate}`)
    ).toEqual([
      "agm:2027-01-21",
      "agm:2028-01-20",
      "special_members:2027-03-01",
      "special_members:2027-09-09",
    ]);
  });
});
