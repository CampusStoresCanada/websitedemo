import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ A person the desk CONFIRMED is seated as that person — never re-matched by
 * email. Logins and Circle accounts are one per address and whoever holds one
 * keeps it (Stephen, 2026-10-19): the second person on info@store.ca gets their
 * own seat and badge, never the first person's login, and no invite.
 */

const { resolveAssigneeForEmailMock, findExistingUserByEmailMock } = vi.hoisted(() => ({
  resolveAssigneeForEmailMock: vi.fn(),
  findExistingUserByEmailMock: vi.fn(),
}));
vi.mock("@/lib/actions/conference-people", () => ({ resolveAssigneeForEmail: resolveAssigneeForEmailMock }));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({ findExistingUserByEmail: findExistingUserByEmailMock }));
vi.mock("../../comms/conference-triggers", () => ({ triggerConferenceRegistrationConfirmation: vi.fn() }));

import { resolveChosenPerson } from "../registration-mint";

/** contacts: the chosen row by id, and a count of OTHERS at the company on the same address. */
function fakeDb(contact: { id: string; profile_id: string | null; organization_id: string } | null, sharers: number) {
  return {
    from: () => {
      let counting = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (_cols: string, opts?: { count?: string }) => {
        counting = Boolean(opts?.count);
        return b;
      };
      for (const m of ["eq", "is", "neq", "or", "limit"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: contact, error: null });
      b.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(counting ? { count: sharers, error: null } : { data: null, error: null }).then(ok);
      return b;
    },
  } as never;
}

const ORG = "org-store";
const BOB = { id: "contact-bob", profile_id: null, organization_id: ORG };

beforeEach(() => {
  vi.clearAllMocks();
  resolveAssigneeForEmailMock.mockResolvedValue({
    success: true,
    data: { targetUserId: "user-new", assignmentStatus: "pending_user_activation", normalizedEmail: "x@y.ca", canonicalPersonId: "c" },
  });
});

describe("resolveChosenPerson", () => {
  it("never links Bob to the login Alice holds on their shared address", async () => {
    findExistingUserByEmailMock.mockResolvedValue("user-alice");
    const r = await resolveChosenPerson(fakeDb(BOB, 1), ORG, BOB.id, "info@store.ca");
    expect(r).toEqual({ contactId: "contact-bob", userId: null, assignmentStatus: "assigned", assignedEmailSnapshot: null });
    expect(resolveAssigneeForEmailMock).not.toHaveBeenCalled();
  });

  it("links the login when it is this person's own", async () => {
    findExistingUserByEmailMock.mockResolvedValue("user-alice");
    const alice = { id: "contact-alice", profile_id: "user-alice", organization_id: ORG };
    const r = await resolveChosenPerson(fakeDb(alice, 1), ORG, alice.id, "info@store.ca");
    expect(r?.userId).toBe("user-alice");
  });

  it("links the login on an address that is theirs alone, even before the record is linked", async () => {
    findExistingUserByEmailMock.mockResolvedValue("user-bob");
    const r = await resolveChosenPerson(fakeDb(BOB, 0), ORG, BOB.id, "bob@store.ca");
    expect(r?.userId).toBe("user-bob");
  });

  it("never links a login already linked to someone else", async () => {
    findExistingUserByEmailMock.mockResolvedValue("user-bob");
    const other = { ...BOB, profile_id: "user-someone" };
    const r = await resolveChosenPerson(fakeDb(other, 0), ORG, other.id, "bob@store.ca");
    expect(r?.userId).toBeNull();
  });

  it("does not invite anyone on a shared address nobody has a login for yet", async () => {
    findExistingUserByEmailMock.mockResolvedValue(null);
    const r = await resolveChosenPerson(fakeDb(BOB, 1), ORG, BOB.id, "info@store.ca");
    expect(r?.userId).toBeNull();
    expect(resolveAssigneeForEmailMock).not.toHaveBeenCalled();
  });

  it("invites the ordinary way when the address is theirs alone and new", async () => {
    findExistingUserByEmailMock.mockResolvedValue(null);
    const r = await resolveChosenPerson(fakeDb(BOB, 0), ORG, BOB.id, "bob@store.ca");
    expect(resolveAssigneeForEmailMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ contactId: "contact-bob", userId: "user-new", assignmentStatus: "pending_user_activation" });
  });

  it("refuses a contact from another company, so the caller falls back", async () => {
    const stranger = { id: "contact-x", profile_id: null, organization_id: "org-other" };
    expect(await resolveChosenPerson(fakeDb(stranger, 0), ORG, stranger.id, "x@y.ca")).toBeNull();
  });
});
