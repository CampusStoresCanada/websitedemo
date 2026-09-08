import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A badge run is catalogue → seats → people, walked forwards.
 *
 * Starting from the registration TYPE means nothing ever has to ask what kind
 * of person somebody is: the type is the loop variable. These tests pin that —
 * particularly that the pipeline carries no vocabulary of its own (no role, no
 * tier, no parsed names), and that a type with no name in its title behaves
 * identically to one that says "Exhibitor".
 */

type Tables = Record<string, { data: unknown[] | null; error: { message: string } | null }>;
let tables: Tables = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.neq = () => b;
      b.in = () => b;
      // resolveBadgeRun now reads conference.badge_* policy for which days
      // print, so the double has to model the calls the real client chains.
      b.is = () => b;
      b.not = () => b;
      b.or = () => b;
      b.gte = () => b;
      b.lte = () => b;
      b.order = () => b;
      b.limit = () => b;
      const one = () =>
        Promise.resolve(tables[table] ?? { data: [], error: null }).then((res) => ({
          data: (res.data ?? [])[0] ?? null,
          error: res.error,
        }));
      b.maybeSingle = one;
      b.single = one;
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve(tables[table] ?? { data: [], error: null }).then(r);
      return b;
    },
  }),
}));

const VIP = "type-vip";
const PUBLIC = "type-public";
const ORG = "org-1";

function entity(id: string, name: string, kind = "registration") {
  return {
    id,
    kind,
    name,
    is_for_sale: true,
    price_cents: 0,
    currency: "CAD",
    attributes: {},
    needs_definition: false,
    inventory: null,
    tier_prices: {},
    qbo_item_id: null,
    sales_window: null,
  };
}

function setup(over: Partial<Tables> = {}) {
  tables = {
    conference_entities: { data: [entity(VIP, "VIP Pass"), entity(PUBLIC, "Public Admission")], error: null },
    conference_entity_refs: { data: [], error: null },
    entity_balance_seats: {
      data: [
        { id: "s1", entity_id: VIP, holder_person_id: "p1", organization_id: ORG },
        { id: "s2", entity_id: VIP, holder_person_id: null, organization_id: ORG },
        { id: "s3", entity_id: PUBLIC, holder_person_id: null, organization_id: ORG },
      ],
      error: null,
    },
    conference_people: {
      data: [
        {
          id: "p1",
          canonical_person_id: "c1",
          display_name: "Ada Lovelace",
          role_title: null,
          contact_email: "ada@example.com",
          assigned_email_snapshot: null,
        },
      ],
      error: null,
    },
    contacts: { data: [{ id: "c1", first_name: "Ada", last_name: "Lovelace", role_title: "Buyer" }], error: null },
    organizations: { data: [{ id: ORG, name: "Sundry Goods" }], error: null },
    ...over,
  };
}

const run = async () => {
  const m = await import("../run");
  return { ...m, result: await m.resolveBadgeRun("conf-1") };
};

beforeEach(() => setup());

describe("resolveBadgeRun groups by registration type", () => {
  // Nothing in the pipeline knows the words "delegate" or "exhibitor". Feed it a
  // home show and it produces the home show's types.
  it("produces one batch per registration type in the catalogue", async () => {
    const { result } = await run();
    expect(result.types.map((t) => t.name)).toEqual(["VIP Pass", "Public Admission"]);
  });

  it("names the layout variant by the type itself", async () => {
    const { result } = await run();
    expect(result.types[0].entityId).toBe(VIP);
  });

  it("treats an unnamed seat as a seat, not as a special mode", async () => {
    const { namedSeats, unnamedSeats, result } = await run();
    expect(namedSeats(result)).toHaveLength(1);
    expect(namedSeats(result)[0].seat.person?.firstName).toBe("Ada");
    expect(unnamedSeats(result)).toHaveLength(2);
    // A blank still knows which type and which org it belongs to.
    expect(unnamedSeats(result)[0].type.name).toBe("VIP Pass");
    expect(unnamedSeats(result)[0].seat.organizationName).toBe("Sundry Goods");
  });

  /**
   * ⛔ The two agendas on one run MUST agree.
   *
   * `types[].agenda` is what a badge with nobody named to it prints — a blank
   * has no person and therefore no entitlement row to read. It was built
   * without the on-site day filter while `entitlements[].agenda` had it, so the
   * same seat described two different conferences depending on whether someone
   * had been named to it: the named card started on the first on-site day and
   * the blank card advertised a pre-conference online session it could not be
   * used at. 152 cards printed that way.
   */
  it("filters the type's agenda to on-site days, exactly as the holder's is", async () => {
    setup({
      conference_entities: {
        data: [
          entity(VIP, "VIP Pass"),
          entity(PUBLIC, "Public Admission"),
          { ...entity("day-pre", "Pre-Conference", "day"), attributes: { date: "2026-01-07" } },
          { ...entity("day-1", "Day One", "day"), attributes: { date: "2026-02-02" } },
          { ...entity("day-2", "Day Two", "day"), attributes: { date: "2026-02-03" } },
          { ...entity("day-3", "Day Three", "day"), attributes: { date: "2026-02-04" } },
          {
            ...entity("s-online", "Online Q&A", "session"),
            attributes: { start_time: "12:00" },
          },
          {
            ...entity("s-floor", "Trade Show", "session"),
            attributes: { start_time: "09:00" },
          },
        ],
        error: null,
      },
      conference_entity_refs: {
        data: [
          { from_entity_id: VIP, to_entity_id: "s-online", role: "includes" },
          { from_entity_id: VIP, to_entity_id: "s-floor", role: "includes" },
          { from_entity_id: "s-online", to_entity_id: "day-pre", role: "when" },
          { from_entity_id: "s-floor", to_entity_id: "day-1", role: "when" },
        ],
        error: null,
      },
    });
    const { result } = await run();
    const type = result.types.find((t) => t.entityId === VIP)!;
    const holder = result.entitlements.find((e) => e.personId === "p1")!;
    expect(type.agenda.map((i) => i.name)).toEqual(["Trade Show"]);
    expect(type.agenda.map((i) => i.name)).toEqual(holder.agenda.map((i) => i.name));
  });

  it("takes identity from the linked contact and flags people without one", async () => {
    const { result } = await run();
    const person = result.types[0].seats.find((s) => s.person)!.person!;
    expect(person.lastName).toBe("Lovelace");
    expect(person.roleTitle).toBe("Buyer");
    expect(person.hasIdentityLink).toBe(true);
  });

  // One person, one face, but two entitlements — a human decides which badge
  // they get, so surface it rather than silently picking the first type.
  it("surfaces a person named to more than one type instead of guessing", async () => {
    setup({
      entity_balance_seats: {
        data: [
          { id: "s1", entity_id: VIP, holder_person_id: "p1", organization_id: ORG },
          { id: "s2", entity_id: PUBLIC, holder_person_id: "p1", organization_id: ORG },
        ],
        error: null,
      },
    });
    const { result } = await run();
    expect(result.peopleInMultipleTypes).toHaveLength(1);
    expect(result.peopleInMultipleTypes[0].typeNames).toEqual(["Public Admission", "VIP Pass"]);
  });

  // The tie-break has one implementation now. Before, the admin page counted
  // per seat, the PDF took last-wins, and /me used an unordered find — three
  // answers for one person.
  it("gives a multi-type person exactly one badge type, deterministically", async () => {
    setup({
      entity_balance_seats: {
        data: [
          { id: "s1", entity_id: PUBLIC, holder_person_id: "p1", organization_id: ORG },
          { id: "s2", entity_id: VIP, holder_person_id: "p1", organization_id: ORG },
        ],
        error: null,
      },
    });
    const { badgeTypeForPerson, result } = await run();
    const first = badgeTypeForPerson(result, "p1");
    expect(first).not.toBeNull();
    // Stable across repeated calls, and it is one of the types they hold.
    expect(badgeTypeForPerson(result, "p1")?.entityId).toBe(first?.entityId);
    expect([VIP, PUBLIC]).toContain(first?.entityId);
    // ...and it is still surfaced rather than silently settled.
    expect(result.peopleInMultipleTypes).toHaveLength(1);
  });

  it("returns null for somebody holding no registration seat", async () => {
    setup({ entity_balance_seats: { data: [], error: null } });
    const { badgeTypeForPerson, result } = await run();
    expect(badgeTypeForPerson(result, "p1")).toBeNull();
  });

  it("never reports a failed read as an empty run", async () => {
    setup({ entity_balance_seats: { data: null, error: { message: "boom" } } });
    const m = await import("../run");
    await expect(m.resolveBadgeRun("conf-1")).rejects.toThrow(/Could not load conference seats/);
  });
});
