import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeFakeDb, callsFor } from "@/lib/test/fake-supabase";

/**
 * attachLoginToContact is the one place a person gets a login at an org.
 *
 * It exists because approval, merge and account recovery each did this by
 * hand and each skipped the contact link whenever the email lookup found the
 * contact (which it always did), leaving 24 of 230 org admins with
 * contacts.profile_id NULL on 2026-11-12. These tests pin the link, which is
 * the thing that kept getting lost.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  findUserByEmail: vi.fn(),
  ensurePersonForUser: vi.fn(),
  linkUserToPerson: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/user-lookup", () => ({ findUserByEmail: mocks.findUserByEmail }));
vi.mock("@/lib/identity/lifecycle", () => ({
  ensureKnownPerson: vi.fn(),
  upsertPersonContact: vi.fn(),
  ensurePersonForUser: mocks.ensurePersonForUser,
  linkUserToPerson: mocks.linkUserToPerson,
}));
vi.mock("@/lib/circle/sync", () => ({ enqueueCircleSync: vi.fn() }));
vi.mock("@/lib/circle/config", () => ({ getAccessGroupIds: vi.fn(() => ({})) }));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn(async () => ({})) }));

import { attachLoginToContact } from "../org-login";

function fakeDb(membership: { id: string; status: string } | null) {
  const fake = makeFakeDb({
    profiles: [{ data: null }],
    user_organizations: [{ data: membership }, { data: null }],
  });
  const auth = {
    admin: {
      createUser: vi.fn(async () => ({ data: { user: { id: "user-new" } }, error: null })),
      inviteUserByEmail: vi.fn(async () => ({ data: { user: { id: "user-new" } }, error: null })),
    },
  };
  mocks.createAdminClient.mockReturnValue({ ...fake.db, auth });
  return { ...fake, auth };
}

const BASE = {
  orgId: "org-kroeger",
  email: "AdamH@KroegerInc.com",
  role: "org_admin" as const,
  displayName: "Adam Hetner",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUserByEmail.mockResolvedValue(null);
  // The email lookup always finds SOME contact: that is what hid the bug.
  mocks.ensurePersonForUser.mockResolvedValue({ personId: "contact-found-by-email" });
});

describe("attachLoginToContact", () => {
  it("links the contact the caller names, even when the email lookup finds a contact", async () => {
    fakeDb(null);

    const result = await attachLoginToContact({
      ...BASE,
      contactId: "contact-adam",
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });

    expect(result).toMatchObject({ success: true, userId: "user-new", linkedContactId: "contact-adam" });
    expect(mocks.linkUserToPerson).toHaveBeenCalledWith({ userId: "user-new", personId: "contact-adam" });
    // A named contact is never second-guessed by an email match.
    expect(mocks.ensurePersonForUser).not.toHaveBeenCalled();
  });

  it("falls back to the lookup only when the caller has no contact", async () => {
    fakeDb(null);

    await attachLoginToContact({ ...BASE, contactId: null, newAccount: "silent", ifAlreadyActive: "keep" });

    expect(mocks.linkUserToPerson).toHaveBeenCalledWith({
      userId: "user-new",
      personId: "contact-found-by-email",
    });
  });

  it("creates a silent account for approval and recovery, and sends nothing", async () => {
    const { auth, recorded } = fakeDb(null);

    const result = await attachLoginToContact({
      ...BASE,
      contactId: "contact-adam",
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });

    expect(auth.admin.createUser).toHaveBeenCalledWith({
      email: "adamh@kroegerinc.com",
      email_confirm: true,
      user_metadata: { display_name: "Adam Hetner" },
    });
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isNewAccount: true, membership: "created" });
    expect(callsFor(recorded, "user_organizations")).toContainEqual({
      method: "insert",
      args: [{ user_id: "user-new", organization_id: "org-kroeger", role: "org_admin", status: "active" }],
    });
  });

  it("sends Supabase's invite only for a magic-link account", async () => {
    const { auth } = fakeDb(null);

    await attachLoginToContact({ ...BASE, contactId: "contact-adam", newAccount: "magic_link", ifAlreadyActive: "refuse" });

    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledWith("adamh@kroegerinc.com");
    expect(auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("reuses an existing account and still links it", async () => {
    mocks.findUserByEmail.mockResolvedValue({ id: "user-existing" });
    const { auth } = fakeDb(null);

    const result = await attachLoginToContact({
      ...BASE,
      contactId: "contact-adam",
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });

    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, isNewAccount: false, membership: "created" });
    expect(mocks.linkUserToPerson).toHaveBeenCalledWith({ userId: "user-existing", personId: "contact-adam" });
  });

  it("leaves an active membership alone when asked to keep it, and links anyway", async () => {
    mocks.findUserByEmail.mockResolvedValue({ id: "user-existing" });
    const { recorded } = fakeDb({ id: "uo-1", status: "active" });

    const result = await attachLoginToContact({
      ...BASE,
      contactId: "contact-adam",
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });

    expect(result).toMatchObject({ success: true, membership: "already_active" });
    const writes = callsFor(recorded, "user_organizations").filter((c) => c.method !== "select" && c.method !== "eq" && c.method !== "maybeSingle");
    expect(writes).toEqual([]);
    expect(mocks.linkUserToPerson).toHaveBeenCalledWith({ userId: "user-existing", personId: "contact-adam" });
  });

  it("refuses an active membership when asked to, for staff invites", async () => {
    mocks.findUserByEmail.mockResolvedValue({ id: "user-existing" });
    fakeDb({ id: "uo-1", status: "active" });

    const result = await attachLoginToContact({
      ...BASE,
      contactId: "contact-adam",
      newAccount: "magic_link",
      ifAlreadyActive: "refuse",
    });

    expect(result).toMatchObject({ success: false, membership: "already_active" });
  });

  it("reactivates an inactive membership with the role asked for and no old end date", async () => {
    mocks.findUserByEmail.mockResolvedValue({ id: "user-existing" });
    const { recorded } = fakeDb({ id: "uo-1", status: "inactive" });

    const result = await attachLoginToContact({
      ...BASE,
      contactId: "contact-adam",
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });

    expect(result).toMatchObject({ success: true, membership: "reactivated" });
    const update = callsFor(recorded, "user_organizations").find((c) => c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "active", role: "org_admin", expires_at: null });
  });
});
