import { describe, expect, it } from "vitest";
import { resolveAccess } from "../entity-commerce";
import { grantTypesForKinds } from "../entity-obligations";
import { collectDataObligations } from "../grants";
import { resolveObligationValues } from "../person-fields";
import type { BuildEntity } from "@/lib/actions/conference-entities";

/**
 * The bug: a registration that INCLUDES meals produced no dietary obligation,
 * because the resolver read the kind of the entity each seat pointed at and
 * stopped. Connected Exhibitor Staff Registration includes twelve meals; those
 * exhibitors were fed twelve times and never asked what they could eat.
 *
 * Modelled on the real CSC 2027 shape, verified against the live graph:
 * registration --includes--> meal, and --involved_in--> session.
 */

const entity = (over: Partial<BuildEntity> & { id: string; kind: string }): BuildEntity =>
  ({
    name: over.id, isForSale: false, priceCents: null, currency: "CAD",
    attributes: {}, needsDefinition: false, inventory: null, tierPrices: {},
    qboItemId: null, salesWindow: null, refs: [], ...over,
  }) as BuildEntity;

function graph(entities: BuildEntity[]) {
  return new Map(entities.map((e) => [e.id, e]));
}

const REGISTRATION = entity({
  id: "connected-reg",
  kind: "registration",
  refs: [
    { toEntityId: "lunch-tue", toName: "Lunch - Tuesday", toKind: "meal", role: "includes", quantity: null },
    { toEntityId: "trade-wed", toName: "Trade Show Wednesday", toKind: "session", role: "involved_in", quantity: null },
  ],
});
const LUNCH = entity({ id: "lunch-tue", kind: "meal" });
const TRADE = entity({ id: "trade-wed", kind: "session" });
const RECEPTION = entity({ id: "reception", kind: "event" });

const WORLD = graph([REGISTRATION, LUNCH, TRADE, RECEPTION]);

const obligationsFor = (heldIds: string[]) => {
  const kinds = new Set<string>();
  for (const id of resolveAccess(heldIds, WORLD)) {
    const k = WORLD.get(id)?.kind;
    if (k) kinds.add(k);
  }
  return collectDataObligations(grantTypesForKinds(kinds)).map((o) => o.key);
};

describe("what a person effectively holds", () => {
  it("asks about dietary for meals bundled INSIDE a registration", () => {
    // The regression. One hop sees only `registration` -> badge_seat, and the
    // twelve meals never produce meal_access.
    expect(obligationsFor(["connected-reg"])).toContain("dietary_restrictions");
  });

  it("still carries the registration's own obligations", () => {
    const keys = obligationsFor(["connected-reg"]);
    expect(keys).toContain("display_name");
    expect(keys).toContain("contact_email");
  });

  it("counts a directly held ticket, not only things reached through an offer", () => {
    // A Meet & Greet bought separately is an `event` in its own right — the
    // one path that worked before, and it must keep working.
    expect(obligationsFor(["reception"])).toContain("dietary_restrictions");
  });

  it("reaches things two roles deep without inventing any", () => {
    const reached = [...resolveAccess(["connected-reg"], WORLD)].sort();
    expect(reached).toEqual(["connected-reg", "lunch-tue", "trade-wed"]);
    // The reception is nobody's business unless they hold it.
    expect(reached).not.toContain("reception");
  });

  it("owes nothing when holding nothing", () => {
    expect(obligationsFor([])).toEqual([]);
  });
});

describe("an obligation we already hold the answer to", () => {
  it("is satisfied by the contact record, not by copying it into the projection", () => {
    // The contradiction this fixes: contact_email and display_name are
    // IDENTITY_PROJECTION fields, refused on conference_people by everybody —
    // yet the obligation checked that very column, found null, and asked. The
    // only way to clear it was a write the policy forbids, so it asked forever.
    const values = resolveObligationValues(
      { display_name: null, contact_email: null, dietary_restrictions: null },
      { name: "Gloria Estefan", work_email: "gloria@miamisound.test", email: null }
    );
    expect(values.display_name).toBe("Gloria Estefan");
    expect(values.contact_email).toBe("gloria@miamisound.test");
    // Dietary is genuinely theirs to give — the contact record cannot answer it.
    expect(values.dietary_restrictions).toBeNull();
  });

  it("lets a badge name differ from the contact's name", () => {
    const values = resolveObligationValues(
      { display_name: "Glo" },
      { name: "Gloria Estefan", work_email: null, email: null }
    );
    expect(values.display_name).toBe("Glo");
  });

  it("prefers the work address over a personal one", () => {
    const values = resolveObligationValues(
      {},
      { name: null, work_email: "gloria@miamisound.test", email: "gloria@home.test" }
    );
    expect(values.contact_email).toBe("gloria@miamisound.test");
  });

  it("asks when nobody has an answer", () => {
    expect(resolveObligationValues({}, null).contact_email).toBeUndefined();
  });
});
