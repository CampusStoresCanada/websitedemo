import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ An address is not a person (project_shared_email_walkup_rules). Alice and
 * Bob both use info@store.ca. "Add a new person" — on the org page, and in the
 * online cart's "who is this seat for?" — used to match Bob to Alice by email
 * and then RENAME Alice's record to Bob, so Bob's paid badge printed whatever
 * that one record said. Same name → that person; a different name → a human
 * chooses; someone new on the address → their own record, no login, no Circle.
 */

const mocks = vi.hoisted(() => ({
  ensureKnownPerson: vi.fn(),
  upsertPersonContact: vi.fn(),
  createPersonOnAddress: vi.fn(),
  provisionOrgLogin: vi.fn(),
  onAddress: [] as Array<{ id: string; name: string }>,
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/circle/sync", () => ({ enqueueNewContactCircleProvisioning: vi.fn() }));
vi.mock("@/lib/supabase/user-lookup", () => ({ findUserByEmail: vi.fn() }));
vi.mock("@/lib/identity/org-login", () => ({ provisionOrgLogin: mocks.provisionOrgLogin }));
vi.mock("@/lib/identity/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/identity/lifecycle")>()),
  ensureKnownPerson: mocks.ensureKnownPerson,
  upsertPersonContact: mocks.upsertPersonContact,
  createPersonOnAddress: mocks.createPersonOnAddress,
}));

/** contacts on info@store.ca at the org — the only admin-client read addContact makes. */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
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
  }),
}));

vi.mock("@/lib/auth/guards", () => ({
  canManageOrganization: () => true,
  requireAuthenticated: async () => ({
    ok: true,
    ctx: {
      userEmail: "admin@store.ca",
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: ORG, name: "Store", tenant_id: "t", membership_status: "active" },
              }),
            }),
          }),
        }),
      },
    },
  }),
}));

import { addContact } from "../add-contact";

const ORG = "org-store";
const ALICE = { id: "contact-alice", name: "Alice Smith" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onAddress = [ALICE];
  // The real ensureKnownPerson matches on email FIRST — so for info@store.ca it
  // hands back Alice whoever was typed.
  mocks.ensureKnownPerson.mockImplementation(async () => ({
    personId: mocks.onAddress[0]?.id ?? "contact-created",
  }));
  mocks.upsertPersonContact.mockImplementation(async (p: { personId: string }) => ({ contactId: p.personId }));
  mocks.createPersonOnAddress.mockResolvedValue({ personId: "contact-bob", addressIsNew: false });
  mocks.provisionOrgLogin.mockResolvedValue({ success: true, outcome: "invited" });
});

const addBob = (sharedAddress?: { contactId: string } | "new") =>
  addContact({ organizationId: ORG, name: "Bob Jones", workEmail: "info@store.ca", sharedAddress });

describe("addContact on a shared address", () => {
  it("asks instead of turning Alice into Bob", async () => {
    const r = await addBob();
    expect(r.success).toBe(false);
    expect(r.code).toBe("SHARED_EMAIL");
    expect(r.sharedWith).toEqual([{ contactId: ALICE.id, name: ALICE.name }]);
    // Nothing written: Alice's record is not renamed, Bob is not merged in.
    expect(mocks.upsertPersonContact).not.toHaveBeenCalled();
    expect(mocks.ensureKnownPerson).not.toHaveBeenCalled();
    expect(mocks.provisionOrgLogin).not.toHaveBeenCalled();
  });

  it("someone new sharing it: their own record, no login", async () => {
    const r = await addBob("new");
    expect(r).toMatchObject({ success: true, contactId: "contact-bob", invite: { status: "skipped", reason: "shared_address" } });
    expect(mocks.createPersonOnAddress).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, name: "Bob Jones", email: "info@store.ca" })
    );
    expect(mocks.upsertPersonContact).not.toHaveBeenCalled();
    expect(mocks.provisionOrgLogin).not.toHaveBeenCalled();
  });

  it("'it's Alice': confirms her, edits nothing", async () => {
    const r = await addBob({ contactId: ALICE.id });
    expect(r).toMatchObject({ success: true, contactId: ALICE.id, name: ALICE.name });
    expect(mocks.upsertPersonContact).not.toHaveBeenCalled();
    expect(mocks.createPersonOnAddress).not.toHaveBeenCalled();
  });

  it("refuses a chosen id that is not on the address", async () => {
    const r = await addBob({ contactId: "contact-elsewhere" });
    expect(r.success).toBe(false);
    expect(mocks.upsertPersonContact).not.toHaveBeenCalled();
  });

  it("same name among several on it: that person, never the other", async () => {
    mocks.onAddress = [ALICE, { id: "contact-bob-old", name: "Bob Jones" }];
    const r = await addBob();
    expect(r).toMatchObject({ success: true, contactId: "contact-bob-old" });
    expect(mocks.upsertPersonContact).toHaveBeenCalledWith(expect.objectContaining({ personId: "contact-bob-old" }));
    expect(mocks.provisionOrgLogin).not.toHaveBeenCalled();
  });

  it("an address nobody is on: the ordinary add, login and all", async () => {
    mocks.onAddress = [];
    const r = await addContact({ organizationId: ORG, name: "Bob Jones", workEmail: "bob@store.ca" });
    expect(r).toMatchObject({ success: true, contactId: "contact-created" });
    expect(mocks.ensureKnownPerson).toHaveBeenCalledTimes(1);
    expect(mocks.provisionOrgLogin).toHaveBeenCalledTimes(1);
  });
});
