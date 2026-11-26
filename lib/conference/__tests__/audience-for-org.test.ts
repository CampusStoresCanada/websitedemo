import { describe, expect, it, vi } from "vitest";

/**
 * The audience an organisation's people are held to when the desk and /me
 * work out which agreements they owe. A non-member day-pass buyer's school
 * must be "non_member", the same answer checkout used, or the desk asks them
 * for the Member Code of Conduct they were never shown (found 2026-11-26).
 */

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/conference/seats", () => ({ loadSeatHoldings: vi.fn() }));
vi.mock("@/lib/policy/engine", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy/engine")>("@/lib/policy/engine");
  return {
    ...actual,
    getProgramsConfig: async () => [
      { orgTypeValue: "Member", conferenceTier: "member" },
      { orgTypeValue: "Vendor Partner", conferenceTier: "partner" },
    ],
  };
});

import { audienceForOrg } from "../legal-acceptance";
import { makeFakeDb } from "../../test/fake-supabase";

async function audienceFor(type: string) {
  const fake = makeFakeDb({ organizations: [{ data: { type } }] });
  return audienceForOrg(fake.db as never, "org-1");
}

describe("audienceForOrg", () => {
  it("members and partners, as before", async () => {
    expect(await audienceFor("Member")).toEqual(["member"]);
    expect(await audienceFor("Vendor Partner")).toEqual(["partner"]);
  });

  it("staff pass through, or their exemption never fires", async () => {
    expect(await audienceFor("Staff")).toEqual(["staff"]);
  });

  it("a Non-Member school is non_member, not member", async () => {
    expect(await audienceFor("Non-Member")).toEqual(["non_member"]);
  });
});
