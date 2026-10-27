import { describe, expect, it } from "vitest";
import {
  contactsWeAdded,
  orgsMatchingLatestAnswer,
  diffSpace,
  qualifyingContactIds,
} from "@/lib/circle/conference-access";
import type { SeatHolding } from "@/lib/conference/seats";

function seat(entityId: string, contactId: string | null, kind = "registration"): SeatHolding {
  return {
    seatId: `${entityId}-${contactId}`,
    conferenceId: "conf",
    organizationId: "org",
    seatIndex: 0,
    entityId,
    entityKind: kind,
    entityName: entityId,
    holderPersonId: contactId ? `p-${contactId}` : null,
    holderName: null,
    holderUserId: null,
    holderContactId: contactId,
    seatedAt: null,
  };
}

describe("qualifyingContactIds", () => {
  const seats = [
    seat("full", "c1"),
    seat("exhibitor", "c2"),
    seat("full", null), // sold, unassigned
    seat("offsite", "c3", "event"), // not a pass
  ];

  it("all-conference takes every assigned registration pass", () => {
    expect([...qualifyingContactIds(seats, { passEntityIds: null })].sort()).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("members-only takes only the listed passes", () => {
    expect([...qualifyingContactIds(seats, { passEntityIds: ["full"] })]).toEqual([
      "c1",
    ]);
  });
});

describe("contactsWeAdded", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  it("folds to the last completed act per contact, for this space only", () => {
    const rows = [
      { idempotency_key: `conf-space-add-7-${A}-2026-10-20T21` },
      { idempotency_key: `conf-space-add-7-${B}-2026-10-20T21` },
      { idempotency_key: `conf-space-remove-7-${B}-2026-10-21T09` },
      { idempotency_key: `conf-space-add-8-${B}-2026-10-21T09` }, // other space
      { idempotency_key: `access-add-${A}-123` }, // not ours
    ];
    expect([...contactsWeAdded(rows, 7)]).toEqual([A]);
  });
});

describe("diffSpace", () => {
  const steve = { contactId: "s", email: "s@x", circleId: "1" }; // added by hand
  it("adds missing holders once per Circle member", () => {
    const wanted = [
      { contactId: "c1", email: "a@x", circleId: "10" },
      { contactId: "c1b", email: "a@x", circleId: "10" }, // same person, second org
      { contactId: "c2", email: "b@x", circleId: "20" },
    ];
    expect(diffSpace(wanted, new Set(["20"]), []).toAdd.map((w) => w.contactId)).toEqual(["c1"]);
  });

  it("removes only people the job added who no longer hold a pass", () => {
    const lapsed = { contactId: "c9", email: "z@x", circleId: "99" };
    const { toRemove } = diffSpace([], new Set(["1", "99"]), [lapsed]);
    expect(toRemove).toEqual([lapsed]);
    expect(toRemove).not.toContain(steve);
  });

  it("keeps a person the job added if any of their contacts still holds a pass", () => {
    const oldContact = { contactId: "c1", email: "a@x", circleId: "10" };
    const newContact = { contactId: "c1b", email: "a@x", circleId: "10" };
    expect(diffSpace([newContact], new Set(["10"]), [oldContact]).toRemove).toEqual([]);
  });
});

describe("orgsMatchingLatestAnswer", () => {
  const BW = "Carleton Technologies - Bookware";
  it("uses each school's latest submitted answer and ignores drafts", () => {
    const rows = [
      { organization_id: "a", fiscal_year: 2025, status: "verified", answer: [BW] },
      { organization_id: "b", fiscal_year: 2025, status: "verified", answer: [BW] },
      { organization_id: "b", fiscal_year: 2026, status: "submitted", answer: ["Prism"] }, // switched
      { organization_id: "c", fiscal_year: 2025, status: "verified", answer: ["Prism"] },
      { organization_id: "c", fiscal_year: 2026, status: "draft", answer: [BW] }, // draft doesn't count
      { organization_id: "d", fiscal_year: 2026, status: "submitted", answer: ["Lightspeed", BW] },
    ];
    expect([...orgsMatchingLatestAnswer(rows, BW)].sort()).toEqual(["a", "d"]);
  });
});
