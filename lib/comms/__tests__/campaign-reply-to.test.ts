import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Campaigns send from a no-reply address. A campaign's own reply-to is the only
 * way a reply reaches a person, so it has to survive being saved, and a blank
 * one has to stay null rather than become an empty header.
 */

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/email/send", () => ({ sendEmailBatch: vi.fn(), sendEmail: vi.fn() }));

import { createCampaign } from "@/lib/comms/send";

function dbCapturingInsert() {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    inserted,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "camp-1" }, error: null }) }) };
      },
    }),
  };
}

const base = { name: "Winter update", audience: { type: "custom_emails", filters: {} } as never };

beforeEach(() => vi.clearAllMocks());

describe("createCampaign reply-to", () => {
  it("saves the address, trimmed", async () => {
    const db = dbCapturingInsert();
    createAdminClientMock.mockReturnValue(db);

    await createCampaign({ ...base, replyTo: "  events@example.ca " });

    expect(db.inserted[0].reply_to).toBe("events@example.ca");
  });

  it.each([undefined, "", "   "])("stores null when it is %j", async (replyTo) => {
    const db = dbCapturingInsert();
    createAdminClientMock.mockReturnValue(db);

    await createCampaign({ ...base, replyTo });

    expect(db.inserted[0].reply_to).toBeNull();
  });
});
