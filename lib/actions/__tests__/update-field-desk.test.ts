import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ The desk corrects a name or title before a reprint (Stephen, 2026-10-21):
 * it saves to the contact record through updateField, never reaches Circle,
 * and a name edit keeps `name` and first/last in step (the badge prints
 * first/last). And the edit no longer re-matches the contact by email, which
 * on a shared inbox could put one person's name on another's record.
 */

let orgAdmin = false;
let deskAllowed = true;
let registeredHere = true;
let contact: Record<string, unknown> = {};
const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
const circle: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: async () => ({
    ok: true,
    ctx: { userId: "temp-1", userEmail: "temp@desk.test", globalRole: "member", supabase: {} },
  }),
  canManageOrganization: () => orgAdmin,
  requireConferenceDeskAccess: async () =>
    deskAllowed ? { ok: true, ctx: { userId: "temp-1" } } : { ok: false, error: "Conference desk access required" },
}));
vi.mock("@/lib/circle/sync", () => ({
  enqueueCircleSync: (item: Record<string, unknown>) => {
    circle.push(item);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/email/send", () => ({ sendContentChangeFyi: async () => undefined }));
vi.mock("@/lib/actions/pending-content-changes", () => ({ queueTier2Change: async () => ({ success: true }) }));
vi.mock("@/lib/membership/mirror", () => ({ mirrorFieldsToMembership: async () => undefined }));
vi.mock("@/lib/benchmarking/manual-edit", () => ({ resolveBenchmarkingEdit: async () => ({ allowed: true }) }));
vi.mock("@/lib/identity/lifecycle", () => ({
  ensureKnownPerson: () => {
    throw new Error("updateField must not re-match a contact by email");
  },
  upsertPersonContact: () => {
    throw new Error("updateField must not re-match a contact by email");
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "limit", "order", "is"]) b[m] = () => b;
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        return b;
      };
      b.insert = () => b;
      b.single = () => Promise.resolve({ data: table === "contacts" ? contact : null, error: null });
      b.maybeSingle = () =>
        Promise.resolve({
          data: table === "conference_people" ? (registeredHere ? { id: "cp-1" } : null) : null,
          error: null,
        });
      b.then = (resolve: (v: unknown) => unknown) => {
        if (patch) updates.push({ table, patch });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      };
      return b;
    },
  }),
}));

const { updateField } = await import("../update-field");

beforeEach(() => {
  orgAdmin = false;
  deskAllowed = true;
  registeredHere = true;
  contact = {
    id: "c-1",
    name: "Jen Smith",
    first_name: "Jen",
    last_name: "Smith",
    work_email: "info@store.test",
    email: null,
    organization_id: "org-1",
    role_title: "Buyer",
  };
  updates.length = 0;
  circle.length = 0;
});

const contactPatch = () => updates.find((u) => u.table === "contacts")?.patch;

describe("the desk correcting a badge name", () => {
  it("saves the first name and keeps the full name in step, without touching Circle", async () => {
    const res = await updateField({
      table: "contacts",
      column: "first_name",
      entityId: "c-1",
      newValue: "Jenna",
      deskConferenceId: "conf-1",
    });
    expect(res.success).toBe(true);
    expect(contactPatch()).toMatchObject({ first_name: "Jenna", name: "Jenna Smith" });
    expect(circle).toHaveLength(0);
  });

  it("saves a title without touching Circle", async () => {
    const res = await updateField({
      table: "contacts",
      column: "role_title",
      entityId: "c-1",
      newValue: "Store Manager",
      deskConferenceId: "conf-1",
    });
    expect(res.success).toBe(true);
    expect(contactPatch()).toMatchObject({ role_title: "Store Manager" });
    expect(circle).toHaveLength(0);
  });

  it("refuses anything but the name and title", async () => {
    const res = await updateField({
      table: "contacts",
      column: "work_email",
      entityId: "c-1",
      newValue: "jen@store.test",
      deskConferenceId: "conf-1",
    });
    expect(res.success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses without desk access", async () => {
    deskAllowed = false;
    const res = await updateField({
      table: "contacts",
      column: "first_name",
      entityId: "c-1",
      newValue: "Jenna",
      deskConferenceId: "conf-1",
    });
    expect(res.success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses a contact who is not registered at that conference", async () => {
    registeredHere = false;
    const res = await updateField({
      table: "contacts",
      column: "first_name",
      entityId: "c-1",
      newValue: "Jenna",
      deskConferenceId: "conf-1",
    });
    expect(res.success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses an empty name", async () => {
    contact = { ...contact, last_name: null, name: "Jen" };
    const res = await updateField({
      table: "contacts",
      column: "first_name",
      entityId: "c-1",
      newValue: "",
      deskConferenceId: "conf-1",
    });
    expect(res.success).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("an org admin editing a name", () => {
  it("splits the full name for the badge and pushes it to Circle", async () => {
    orgAdmin = true;
    const res = await updateField({ table: "contacts", column: "name", entityId: "c-1", newValue: "Mary Ann Lee" });
    expect(res.success).toBe(true);
    expect(contactPatch()).toMatchObject({ name: "Mary Ann Lee", first_name: "Mary", last_name: "Ann Lee" });
    expect(circle[0]?.payload).toEqual({ name: "Mary Ann Lee" });
  });
});
