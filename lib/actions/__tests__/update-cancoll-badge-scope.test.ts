import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Where the literal "CANCOLL" may be written.
 *
 * ⛔ `organizations.certifications` is publicly visible, and
 * lib/homepage.ts's fetchMapOrgsWithBenchmarking selects it viewer-agnostic
 * and ISR-cached. So the string written onto a MEMBER store rides out in the
 * map payload to every anonymous visitor, where the reciprocal gate
 * (lib/visibility/cancoll.ts) never runs — that gate sits on the org-page read
 * path only.
 *
 * This action used to write the string unconditionally, which is why it had no
 * member-side caller it could safely have. The member toggle on MemberProfile
 * exists because of the branch these tests pin.
 *
 * Stated as an invariant rather than a skip — present iff partner AND in the
 * group — so the string is also cleaned off a non-partner that somehow
 * acquired one. Matches the live rows: all 12 partner holders carry both the
 * flag and the string, and all 51 member plus 2 non-member holders carry the
 * flag alone (measured 2026-10-19).
 */

const { createAdminClientMock, getServerAuthStateMock, mirrorMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getServerAuthStateMock: vi.fn(),
  mirrorMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/auth/server", () => ({ getServerAuthState: getServerAuthStateMock }));
vi.mock("@/lib/membership/mirror", () => ({ mirrorFieldsToMembership: mirrorMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateCancollStatus } from "../update-certifications";

const ORG_ID = "org-under-test";

interface Written {
  update?: Record<string, unknown>;
  audit?: Record<string, unknown>;
}

/** Captures the UPDATE payload and the audit row so both can be asserted. */
function mockDb(org: {
  name: string;
  type: string;
  certifications: string[];
  is_cancoll_member: boolean;
}): Written {
  const written: Written = {};
  const client = {
    from: (table: string) => {
      if (table === "audit_log") {
        return {
          insert: (row: Record<string, unknown>) => {
            written.audit = row;
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            // Both shapes, so this file measures behaviour rather than which
            // terminator the action happens to call. Without `single` the
            // pre-fix version fails to read at all and every assertion below
            // fails mechanically, which would make a mutation check look
            // decisive while proving nothing.
            maybeSingle: () => Promise.resolve({ data: org, error: null }),
            single: () => Promise.resolve({ data: org, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          written.update = payload;
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  createAdminClientMock.mockReturnValue(client);
  return written;
}

function cscAdmin() {
  return {
    user: { id: "staff-1", email: "steve@campusstores.ca" },
    globalRole: "admin" as const,
    permissionState: "admin" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerAuthStateMock.mockResolvedValue(cscAdmin());
});

describe("the CANCOLL badge string is scoped to vendor partners", () => {
  it("writes the string when a partner joins the group", async () => {
    const w = mockDb({
      name: "Some Vendor",
      type: "Vendor Partner",
      certifications: ["Canadian Owned"],
      is_cancoll_member: false,
    });

    const result = await updateCancollStatus(ORG_ID, true);

    expect(result.success).toBe(true);
    expect(w.update?.is_cancoll_member).toBe(true);
    expect(w.update?.certifications).toEqual(["Canadian Owned", "CANCOLL"]);
  });

  it("does NOT write the string for a member store", async () => {
    const w = mockDb({
      name: "A Campus Store",
      type: "Member",
      certifications: [],
      is_cancoll_member: false,
    });

    const result = await updateCancollStatus(ORG_ID, true);

    expect(result.success).toBe(true);
    expect(w.update?.is_cancoll_member).toBe(true);
    // Absent entirely, not an empty array: the column must be left untouched
    // so a member's own badge list is never rewritten by a standing change.
    expect(w.update && "certifications" in w.update).toBe(false);
  });

  it("strips the string off a non-partner that already carries it", async () => {
    const w = mockDb({
      name: "Mislabelled Store",
      type: "Member",
      certifications: ["CANCOLL"],
      is_cancoll_member: true,
    });

    const result = await updateCancollStatus(ORG_ID, true);

    expect(result.success).toBe(true);
    // Still in the group, still a member — so the flag stays and the public
    // string goes. An invariant, not a skip.
    expect(w.update?.is_cancoll_member).toBe(true);
    expect(w.update?.certifications).toEqual([]);
  });

  it("removes the string when a partner leaves the group", async () => {
    const w = mockDb({
      name: "Some Vendor",
      type: "Vendor Partner",
      certifications: ["CANCOLL", "Fair Trade"],
      is_cancoll_member: true,
    });

    await updateCancollStatus(ORG_ID, false);

    expect(w.update?.is_cancoll_member).toBe(false);
    expect(w.update?.certifications).toEqual(["Fair Trade"]);
  });

  it("records who changed it, because CANCOLL feeds pricing", async () => {
    const w = mockDb({
      name: "A Campus Store",
      type: "Member",
      certifications: [],
      is_cancoll_member: false,
    });

    await updateCancollStatus(ORG_ID, true);

    expect(w.audit?.action).toBe("field.update");
    expect(w.audit?.entity_id).toBe(ORG_ID);
    expect(w.audit?.actor_id).toBe("staff-1");
    const details = w.audit?.details as Record<string, unknown>;
    expect(details.column).toBe("is_cancoll_member");
    expect(details.previous_value).toBe(false);
    expect(details.new_value).toBe(true);
    expect(details.entity_name).toBe("A Campus Store");
  });

  it("refuses a non-admin", async () => {
    getServerAuthStateMock.mockResolvedValue({
      user: { id: "u2", email: "buyer@school.ca" },
      globalRole: "user" as const,
      permissionState: "member" as const,
    });
    const w = mockDb({
      name: "A Campus Store",
      type: "Member",
      certifications: [],
      is_cancoll_member: false,
    });

    const result = await updateCancollStatus(ORG_ID, true);

    expect(result.success).toBe(false);
    expect(w.update).toBeUndefined();
  });
});
