import { describe, it, expect } from "vitest";
import {
  MEMBERS_MEETING_TYPES,
  MEMBERS_MEETING_LABELS,
  isMembersMeetingType,
  agmEventSlug,
  venueOf,
  venueFields,
  membersMeetingGaps,
  type MembersMeeting,
} from "@/lib/governance/members-meetings";

function meeting(over: Partial<MembersMeeting> = {}): MembersMeeting {
  return {
    id: "m1",
    meetingDate: "2027-01-21",
    meetingType: "agm",
    title: "CSC Annual General Meeting — 2027-01-21",
    status: "upcoming",
    notes: null,
    hasAgenda: false,
    hasMinutes: false,
    documentCount: 0,
    proxyCount: 0,
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

describe("venueFields", () => {
  it("clears the address when the meeting moves online", () => {
    // Otherwise last year's hotel sits on the record of an online meeting.
    expect(venueFields("virtual", { location: "Hotel, Calgary", virtualLink: "https://m/x" }))
      .toEqual({ is_virtual: true, location: null, virtual_link: "https://m/x" });
  });

  it("clears the joining link for an in-person meeting", () => {
    expect(venueFields("in_person", { location: "Hotel, Calgary", virtualLink: "https://m/x" }))
      .toEqual({ is_virtual: false, location: "Hotel, Calgary", virtual_link: null });
  });

  it("keeps both for a hybrid meeting", () => {
    expect(venueFields("hybrid", { location: "Hotel, Calgary", virtualLink: "https://m/x" }))
      .toEqual({ is_virtual: true, location: "Hotel, Calgary", virtual_link: "https://m/x" });
  });

  it("round-trips through venueOf", () => {
    for (const venue of ["virtual", "in_person", "hybrid"] as const) {
      const f = venueFields(venue, { location: "Somewhere", virtualLink: "https://m/x" });
      expect(venueOf({ isVirtual: f.is_virtual, location: f.location })).toBe(venue);
    }
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
