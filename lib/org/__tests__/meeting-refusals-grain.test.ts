import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The one invariant that matters here: a DELEGATE'S refusal must never become
 * their COMPANY'S.
 *
 * An org refusal is symmetrical and binds everyone under that company. A person
 * refusal binds one seat. They live in one table separated only by
 * `declaring_contact_id`, so a missing filter is invisible in review and
 * catastrophic in effect — one buyer's "rather not" would silently black out
 * the pair for every colleague AND in the reverse direction, which is three
 * claims nobody made.
 */

type Row = {
  declaring_org_id: string;
  declaring_contact_id: string | null;
  refused_org_id: string;
  reason: string | null;
  first_declared_at: string;
  reaffirmed_at: string | null;
};

const STORE = "store";
const VENDOR = "vendor";
const BUYER = "buyer-contact";

let rows: Row[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ is: async () => ({ data: rows, error: null }) }),
    }),
  }),
}));

const { loadBlackoutListsByOrg, loadBlackoutListsByContact } = await import(
  "../meeting-refusals"
);

function row(declaringContactId: string | null): Row {
  return {
    declaring_org_id: STORE,
    declaring_contact_id: declaringContactId,
    refused_org_id: VENDOR,
    reason: null,
    first_declared_at: "2026-09-01T00:00:00Z",
    reaffirmed_at: null,
  };
}

beforeEach(() => {
  rows = [];
});

describe("refusal grain", () => {
  it("keeps a delegate's refusal out of their org's list", async () => {
    rows = [row(BUYER)];
    const byOrg = await loadBlackoutListsByOrg([STORE, VENDOR]);
    expect(byOrg.get(STORE) ?? []).toEqual([]);
  });

  it("does not mirror a delegate's refusal onto the vendor", async () => {
    // The org version mirrors both ways — either side may fire the other. A
    // person saying "not them" says nothing about the vendor's willingness.
    rows = [row(BUYER)];
    const byOrg = await loadBlackoutListsByOrg([STORE, VENDOR]);
    expect(byOrg.get(VENDOR) ?? []).toEqual([]);
  });

  it("returns the delegate's refusal on their own list", async () => {
    rows = [row(BUYER)];
    const byContact = await loadBlackoutListsByContact([BUYER]);
    expect(byContact.get(BUYER)).toEqual([VENDOR]);
  });

  it("leaves a colleague's list untouched", async () => {
    // Three buyers from one store legitimately want three different sets of
    // meetings — one opting out must not opt the others out.
    rows = [row(BUYER)];
    const byContact = await loadBlackoutListsByContact([BUYER, "colleague"]);
    expect(byContact.get("colleague") ?? []).toEqual([]);
  });

  it("still mirrors an ORG refusal both ways", async () => {
    rows = [row(null)];
    const byOrg = await loadBlackoutListsByOrg([STORE, VENDOR]);
    expect(byOrg.get(STORE)).toEqual([VENDOR]);
    expect(byOrg.get(VENDOR)).toEqual([STORE]);
  });

  it("does not put an org refusal on any person's list", async () => {
    rows = [row(null)];
    const byContact = await loadBlackoutListsByContact([BUYER]);
    expect(byContact.get(BUYER) ?? []).toEqual([]);
  });
});
