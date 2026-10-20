import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Assigning an organisation's open seat to Bob, who shares info@store.ca
 * with Alice, seats Bob (HeldOfferCard → addConferenceAttendee → allocateSeat).
 * The picker hands over the contact it picked; matching by email instead found
 * Alice's attendee row and gave her the seat. Bob gets his own seat and badge,
 * not Alice's login.
 */

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  createAdminClient: vi.fn(),
  resolveAssigneeForEmail: vi.fn(),
  findUserByEmail: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireAdmin: vi.fn(),
  isConferenceDeskStaff: vi.fn(async () => false),
  canManageOrganization: vi.fn(() => true),
  isGlobalAdmin: vi.fn(() => false),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/actions/conference-people", () => ({ resolveAssigneeForEmail: mocks.resolveAssigneeForEmail }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: vi.fn() }));
vi.mock("@/lib/supabase/user-lookup", () => ({ findUserByEmail: mocks.findUserByEmail }));
vi.mock("@/lib/comms/conference-triggers", () => ({ triggerConferenceRegistrationConfirmation: vi.fn() }));
vi.mock("@/lib/circle/sync", () => ({ enqueueNewContactCircleProvisioning: vi.fn() }));

import { addConferenceAttendee, allocateSeat } from "../conference-entity-commerce";

type Row = Record<string, unknown>;

/** An in-memory table set that honours the filters these two actions use. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 0;
  return {
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`Unexpected table: ${table}`);
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      let head = false;
      const run = () => {
        if (op === "insert") {
          const row = { id: `new-${table}-${++nextId}`, ...payload };
          rows.push(row);
          return [row];
        }
        const hits = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") for (const r of hits) Object.assign(r, payload);
        return hits;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: (_cols?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
        insert: (row: Row) => ((op = "insert"), (payload = row), b),
        update: (row: Row) => ((op = "update"), (payload = row), b),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        ilike: (c: string, v: string) =>
          (filters.push((r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase()), b),
        or: (expr: string) => {
          const alts = expr.split(",").map((p) => p.split(".eq."));
          filters.push((r) => alts.some(([c, v]) => r[c] === v));
          return b;
        },
        limit: () => b,
        single: async () => {
          const [row] = run();
          return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          const hits = run();
          return Promise.resolve(head ? { count: hits.length, error: null } : { data: hits, error: null }).then(ok);
        },
      };
      return b;
    },
  };
}

const ORG = "org-store";
const CONF = "conf-2027";
const SHARED = "info@store.ca";

let tables: Record<string, Row[]>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockResolvedValue({
    ok: true,
    ctx: { userId: "org-admin", globalRole: "user", activeOrgIds: [ORG] },
  });
  // The address's one login is Alice's.
  mocks.findUserByEmail.mockImplementation(async (_db: unknown, email: string) =>
    email.toLowerCase() === SHARED ? { id: "user-alice" } : null
  );
  tables = {
    contacts: [
      { id: "contact-alice", name: "Alice Smith", organization_id: ORG, profile_id: "user-alice", work_email: SHARED, email: null, archived_at: null },
      { id: "contact-bob", name: "Bob Jones", organization_id: ORG, profile_id: null, work_email: SHARED, email: null, archived_at: null },
    ],
    // Alice is already at the conference for this store.
    conference_people: [
      { id: "cp-alice", conference_id: CONF, organization_id: ORG, canonical_person_id: "contact-alice", contact_email: SHARED, display_name: "Alice Smith", user_id: "user-alice", assignment_status: "assigned" },
    ],
    entity_balance_seats: [
      { id: "seat-open", conference_id: CONF, organization_id: ORG, entity_id: "ent-booth-staff", holder_person_id: null },
    ],
    conference_entities: [{ id: "ent-booth-staff", kind: "booth", name: "Booth Staff", attributes: null }],
  };
  mocks.createAdminClient.mockImplementation(() => fakeDb(tables));
  // The ordinary by-email path: the address belongs to Alice.
  mocks.resolveAssigneeForEmail.mockResolvedValue({
    success: true,
    data: { targetUserId: "user-alice", assignmentStatus: "assigned", normalizedEmail: SHARED, canonicalPersonId: "contact-alice" },
  });
});

/** What HeldOfferCard's assignTo does with the picker's choice. */
async function assign(person: { name: string; email: string | null; contactId: string }) {
  const added = await addConferenceAttendee(CONF, ORG, {
    displayName: person.name,
    contactEmail: person.email,
    contactId: person.contactId,
  });
  if (!added.success) throw new Error(added.error);
  const seated = await allocateSeat("seat-open", added.data.id);
  if (!seated.success) throw new Error(seated.error);
  return added.data.id;
}

describe("assigning a held seat on a shared address", () => {
  it("seats Bob's contact, not Alice's, and gives Bob no login", async () => {
    const id = await assign({ name: "Bob Jones", email: SHARED, contactId: "contact-bob" });

    expect(id).not.toBe("cp-alice");
    const holder = tables.conference_people.find((p) => p.id === tables.entity_balance_seats[0].holder_person_id);
    expect(holder).toMatchObject({ canonical_person_id: "contact-bob", display_name: "Bob Jones", user_id: null });
    expect(mocks.resolveAssigneeForEmail).not.toHaveBeenCalled();
    // Alice's records are untouched.
    expect(tables.conference_people.find((p) => p.id === "cp-alice")).toMatchObject({ display_name: "Alice Smith" });
    expect(tables.contacts.find((c) => c.id === "contact-alice")).toMatchObject({ name: "Alice Smith", profile_id: "user-alice" });
  });

  it("picking Alice reuses Alice's own attendee row", async () => {
    expect(await assign({ name: "Alice Smith", email: SHARED, contactId: "contact-alice" })).toBe("cp-alice");
    expect(tables.entity_balance_seats[0].holder_person_id).toBe("cp-alice");
  });

  it("refuses a contact from another organisation rather than matching by email", async () => {
    tables.contacts.push({ id: "contact-elsewhere", name: "Eve", organization_id: "org-other", profile_id: null, work_email: SHARED, email: null, archived_at: null });
    const added = await addConferenceAttendee(CONF, ORG, { displayName: "Eve", contactEmail: SHARED, contactId: "contact-elsewhere" });
    expect(added.success).toBe(false);
    expect(tables.conference_people).toHaveLength(1);
  });
});
