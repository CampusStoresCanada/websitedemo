import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ A paid seat for Bob on info@store.ca, which Alice also uses, is Bob's.
 * The cart's picker carries the contact a buyer chose; a cart line without one
 * (filled before it did) is never handed to whoever else is on the address.
 */

const mocks = vi.hoisted(() => ({
  createPersonOnAddress: vi.fn(),
  onAddress: [] as Array<{ id: string; name: string }>,
}));

vi.mock("@/lib/actions/conference-people", () => ({ resolveAssigneeForEmail: vi.fn() }));
vi.mock("@/lib/actions/conference-entity-commerce", () => ({ findExistingUserByEmail: vi.fn() }));
vi.mock("../../comms/conference-triggers", () => ({ triggerConferenceRegistrationConfirmation: vi.fn() }));
vi.mock("@/lib/circle/sync", () => ({ enqueueNewContactCircleProvisioning: vi.fn() }));
vi.mock("@/lib/supabase/user-lookup", () => ({ findUserByEmail: vi.fn() }));
vi.mock("@/lib/identity/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/identity/lifecycle")>()),
  createPersonOnAddress: mocks.createPersonOnAddress,
}));

import { personNamedForSeat } from "../registration-mint";

function fakeDb() {
  return {
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "is", "or"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({
          data: mocks.onAddress.map((c) => ({ id: c.id, name: c.name, role_title: null, phone: null, work_phone_number: null })),
          error: null,
        }).then(ok);
      return b;
    },
  } as never;
}

const ORG = "org-store";
const ALICE = { id: "contact-alice", name: "Alice Smith" };
const bob = { name: "Bob Jones", email: "info@store.ca" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onAddress = [ALICE];
  mocks.createPersonOnAddress.mockResolvedValue({ personId: "contact-bob-new", addressIsNew: false });
});

describe("personNamedForSeat", () => {
  it("the person the buyer picked, as picked", async () => {
    expect(await personNamedForSeat(fakeDb(), ORG, { ...bob, contactId: "contact-bob" })).toBe("contact-bob");
    expect(mocks.createPersonOnAddress).not.toHaveBeenCalled();
  });

  it("Bob on Alice's address, nobody picked: a new Bob, never Alice", async () => {
    expect(await personNamedForSeat(fakeDb(), ORG, bob)).toBe("contact-bob-new");
    expect(mocks.createPersonOnAddress).toHaveBeenCalledWith({ organizationId: ORG, name: "Bob Jones", email: "info@store.ca" });
  });

  it("the same name among several on the address: that person", async () => {
    mocks.onAddress = [ALICE, { id: "contact-bob", name: "bob jones" }];
    expect(await personNamedForSeat(fakeDb(), ORG, bob)).toBe("contact-bob");
    expect(mocks.createPersonOnAddress).not.toHaveBeenCalled();
  });

  it("alone on the address, or nobody on it: the ordinary path, unchanged", async () => {
    mocks.onAddress = [{ id: "contact-bob", name: "Bob Jones" }];
    expect(await personNamedForSeat(fakeDb(), ORG, bob)).toBeNull();
    mocks.onAddress = [];
    expect(await personNamedForSeat(fakeDb(), ORG, bob)).toBeNull();
    expect(mocks.createPersonOnAddress).not.toHaveBeenCalled();
  });
});
