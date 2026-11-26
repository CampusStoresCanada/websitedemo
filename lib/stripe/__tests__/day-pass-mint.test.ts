import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A paid non-member day pass (the NIPSA Wednesday rate, 2026-11) must leave a
 * real attendee behind: a contact, the agreements they ticked, a login for /me
 * and a Circle account, without their school becoming a member, and without
 * ever merging two people who share an address.
 */

const {
  peopleOnAddressMock,
  createPersonOnAddressMock,
  provisionOrgLoginMock,
  personOwedAgreementsMock,
  recordOwedAgreementsMock,
  triggerConfirmationMock,
} = vi.hoisted(() => ({
  peopleOnAddressMock: vi.fn(),
  createPersonOnAddressMock: vi.fn(),
  provisionOrgLoginMock: vi.fn(),
  personOwedAgreementsMock: vi.fn(),
  recordOwedAgreementsMock: vi.fn(),
  triggerConfirmationMock: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({ parseUTC: (s: string) => new Date(s) }));
vi.mock("@/lib/membership/state-machine", () => ({ transitionMembershipState: vi.fn() }));
vi.mock("@/lib/quickbooks/export", () => ({ enqueueQBExport: vi.fn(), enqueueQBExportRefund: vi.fn() }));
vi.mock("@/lib/quickbooks/conference-export", () => ({
  enqueueQBConferenceReceipt: vi.fn(),
  enqueueQBConferenceRefund: vi.fn(),
  enqueueQBMiscReceipt: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));
vi.mock("@/lib/actions/conference-people", () => ({ resolveAssigneeForEmail: vi.fn() }));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({ findExistingUserByEmail: vi.fn() }));
vi.mock("../../comms/conference-triggers", () => ({
  triggerConferenceRegistrationConfirmation: triggerConfirmationMock,
  triggerConferencePaymentConfirmation: vi.fn(),
  triggerProspectiveBoothPaymentConfirmation: vi.fn(),
}));
vi.mock("@/lib/identity/lifecycle", () => ({
  peopleOnAddress: peopleOnAddressMock,
  createPersonOnAddress: createPersonOnAddressMock,
}));
vi.mock("@/lib/identity/org-login", () => ({ provisionOrgLogin: provisionOrgLoginMock }));
vi.mock("@/lib/conference/legal-acceptance", () => ({ personOwedAgreements: personOwedAgreementsMock }));
vi.mock("@/lib/conference/check-in-agreements", () => ({ recordOwedAgreements: recordOwedAgreementsMock }));

import { mintProspectiveRegistration } from "../webhook-processing";
import { callsFor, makeFakeDb, type QueryResult } from "../../test/fake-supabase";

const row = {
  id: "pay-1",
  email: "pat@school.example",
  first_name: "Pat",
  last_name: "Lee",
  organization_name: "St. Example School",
  job_title: "Store Manager",
  phone: "555-0100",
  dietary_restrictions: null,
  conference_id: "conf-1",
  offer_entity_id: "nipsa-pass",
  amount_cents: 24900,
  accepted_document_types: ["privacy_notice", "terms_and_conditions"],
};

/** The table reads and writes the mint makes, in order, for a buyer the fake can answer. */
function dbFor(opts: { existingOrg?: { id: string; type: string } | null; profileId?: string | null } = {}) {
  const queues: Record<string, QueryResult[]> = {
    organizations: [{ data: opts.existingOrg ?? null }, { data: null }],
    conference_people: [{ data: { id: "person-1" } }, { data: null }],
    entity_balances: [{ data: [{ id: "bal-1" }] }],
    entity_balance_seats: [{ data: null }],
    prospective_registration_payments: [{ data: null }],
    contacts: [{ data: { profile_id: opts.profileId ?? "user-1" } }],
    conference_entities: [{ data: { name: "Wednesday Day Pass (NIPSA)" } }],
  };
  return makeFakeDb(queues, { mint_prospective_registration_purchase: { data: "purchase-1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  peopleOnAddressMock.mockResolvedValue({ sameName: null, others: [] });
  createPersonOnAddressMock.mockResolvedValue({ personId: "contact-1", addressIsNew: true });
  personOwedAgreementsMock.mockResolvedValue([
    { versionId: "v-privacy", documentType: "privacy_notice", content: "" },
    { versionId: "v-terms", documentType: "terms_and_conditions", content: "" },
    { versionId: "v-other", documentType: "photo_release", content: "" },
  ]);
  recordOwedAgreementsMock.mockResolvedValue({ success: true, data: { stillOwed: 1 } });
  provisionOrgLoginMock.mockResolvedValue({ success: true, outcome: "invited" });
});

describe("a paid non-member day pass", () => {
  it("creates the attendee's contact and puts it on their attendee row", async () => {
    const fake = dbFor();
    await mintProspectiveRegistration(fake.db as never, row);

    expect(createPersonOnAddressMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Pat Lee", email: row.email, title: "Store Manager", contactType: ["conference"] })
    );
    const insert = callsFor(fake.recorded, "conference_people").find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ contact_id: "contact-1", canonical_person_id: "contact-1" });
  });

  it("records only the agreements they ticked, as their own acceptance", async () => {
    const fake = dbFor();
    await mintProspectiveRegistration(fake.db as never, row);

    expect(recordOwedAgreementsMock).toHaveBeenCalledWith({
      conferenceId: "conf-1",
      personId: "person-1",
      versionIds: ["v-privacy", "v-terms"],
      via: "self",
      recordedBy: null,
    });
  });

  it("gives them a silent login with no 'added as a member' email, and puts it on the attendee row", async () => {
    const fake = dbFor({ profileId: "user-9" });
    await mintProspectiveRegistration(fake.db as never, row);

    expect(provisionOrgLoginMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: row.email, personId: "contact-1", newAccount: "silent", announce: false })
    );
    const linked = callsFor(fake.recorded, "conference_people").find((c) => c.method === "update");
    expect(linked?.args[0]).toEqual({ user_id: "user-9" });
    expect(triggerConfirmationMock).toHaveBeenCalled();
  });

  it("makes the login BEFORE recording agreements, so the acceptances carry it", async () => {
    const fake = dbFor();
    await mintProspectiveRegistration(fake.db as never, row);
    const loginAt = provisionOrgLoginMock.mock.invocationCallOrder[0];
    const agreementsAt = recordOwedAgreementsMock.mock.invocationCallOrder[0];
    expect(loginAt).toBeLessThan(agreementsAt);
  });

  it("on an address someone else at that school already uses: their own record, no login", async () => {
    peopleOnAddressMock.mockResolvedValue({ sameName: null, others: [{ contactId: "alice", name: "Alice" }] });
    createPersonOnAddressMock.mockResolvedValue({ personId: "contact-2", addressIsNew: false });
    const fake = dbFor();
    await mintProspectiveRegistration(fake.db as never, row);

    const insert = callsFor(fake.recorded, "conference_people").find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ contact_id: "contact-2" });
    expect(provisionOrgLoginMock).not.toHaveBeenCalled();
    // Their agreements are still theirs to record.
    expect(recordOwedAgreementsMock).toHaveBeenCalled();
  });

  it("on an address that already has a login or a contact elsewhere: no login", async () => {
    createPersonOnAddressMock.mockResolvedValue({ personId: "contact-3", addressIsNew: false });
    const fake = dbFor();
    await mintProspectiveRegistration(fake.db as never, row);
    expect(provisionOrgLoginMock).not.toHaveBeenCalled();
  });

  it("the same name on the address is that person: no new record", async () => {
    peopleOnAddressMock.mockResolvedValue({ sameName: { contactId: "pat-already" }, others: [] });
    const fake = dbFor({ existingOrg: { id: "org-existing", type: "Non-Member" } });
    await mintProspectiveRegistration(fake.db as never, row);

    expect(createPersonOnAddressMock).not.toHaveBeenCalled();
    expect(provisionOrgLoginMock).toHaveBeenCalledWith(expect.objectContaining({ personId: "pat-already", orgId: "org-existing" }));
  });

  it("a second buyer from the same school joins that school's Non-Member organisation", async () => {
    const fake = dbFor({ existingOrg: { id: "org-existing", type: "Non-Member" } });
    await mintProspectiveRegistration(fake.db as never, row);

    expect(callsFor(fake.recorded, "organizations").some((c) => c.method === "insert")).toBe(false);
    expect(peopleOnAddressMock).toHaveBeenCalledWith(expect.anything(), "org-existing", row.email, "Pat Lee");
  });

  it("never borrows a member's record that happens to share the name", async () => {
    const fake = dbFor({ existingOrg: { id: "member-org", type: "Member" } });
    await mintProspectiveRegistration(fake.db as never, row);

    const insert = callsFor(fake.recorded, "organizations").find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ type: "Non-Member", name: "St. Example School" });
    expect((insert?.args[0] as { slug: string }).slug).toMatch(/^st-example-school-\d+$/);
    expect(peopleOnAddressMock).not.toHaveBeenCalledWith(expect.anything(), "member-org", expect.anything(), expect.anything());
  });

  it("a failed login never costs them the seat", async () => {
    provisionOrgLoginMock.mockRejectedValue(new Error("auth down"));
    const fake = dbFor();
    await mintProspectiveRegistration(fake.db as never, row);

    expect(fake.recordedRpcs.map((r) => r.fn)).toContain("mint_prospective_registration_purchase");
    const minted = callsFor(fake.recorded, "prospective_registration_payments").find((c) => c.method === "update");
    expect(minted?.args[0]).toMatchObject({ status: "minted" });
    expect(triggerConfirmationMock).toHaveBeenCalled();
  });
});
