/**
 * What `includes` MEANS.
 *
 * `includes` was built as a shape — an edge you could draw in Build, described
 * only by a tooltip ("What this is made of or bundles"). Nothing ever said what
 * drawing it OBLIGES. So six readers each decided for themselves, none of them
 * sharing code:
 *
 *   entity-commerce   you are entitled to it
 *   floor-surfaces    it is placed where its container is
 *   agenda            it nests under its container
 *   conference-entities (validation)  it cannot contain itself
 *   conference-entities (suite lookup) it is "located at" that booth
 *   the scheduler     — nothing. It gave up and read a hand-typed attribute.
 *
 * Audited 2026-08-31 against all 126 `includes` rows on CSC 2027. Every single
 * one reads the same way — registration→meal, booth→suite, booth→item,
 * booth→registration, registration→day, registration→event, event→meal:
 *
 *      HOLDING THE CONTAINER GIVES YOU THE CONTENTS.
 *
 * Not one exception. So `includes` is not overloaded; it has one meaning and
 * five separately-written consequences. This module is that meaning, written
 * once, so the consequences stop being hand-copies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ `includes` and `involved_in` are NOT the same closure.
 *
 * `includes` is part-of: the suite is part of the booth, the table is part of
 * the booth. Ownership and position flow down it, because owning a thing owns
 * its parts and a part sits where its whole sits.
 *
 * `involved_in` is participation: an Exhibitor Registration is involved_in the
 * Trade Show. That gets you IN. It does not make the Trade Show part of your
 * registration — you do not own it, and it is not located inside it.
 *
 * So: ACCESS flows through both. OWNERSHIP and POSITION flow through `includes`
 * only. Collapsing them would have the first exhibitor to buy a booth "own" the
 * trade show floor.
 */

/** Part-of. Ownership and position flow down this, and only this. */
export const CONTAINMENT_ROLE = "includes" as const;

/**
 * Getting in flows down these. A superset of containment — participation gets
 * you through the door without making you an owner.
 */
export const ACCESS_ROLES = ["includes", "involved_in"] as const;

/** The minimal ref shape both directions need. Matches the DB row and PlacementRef. */
export type InclusionRef = {
  from_entity_id: string;
  to_entity_id: string;
  role: string;
};

/**
 * Every container of `entityId`, nearest first — suite → booth → whatever holds
 * the booth. Walks UP the containment edges.
 *
 * The reverse direction is the one nothing had. `resolveAccess` runs forwards
 * (given what an org holds, what can it reach), which cannot answer "who holds
 * suite 202" without resolving every org in the conference and testing each.
 *
 * Cycle-safe: `includes` is validated acyclic on write, but a bad row must not
 * hang a page, so a repeat visit stops the walk.
 */
export function containerChain(entityId: string, refs: readonly InclusionRef[]): string[] {
  const parentsOf = new Map<string, string[]>();
  for (const r of refs) {
    if (r.role !== CONTAINMENT_ROLE) continue;
    const list = parentsOf.get(r.to_entity_id);
    if (list) list.push(r.from_entity_id);
    else parentsOf.set(r.to_entity_id, [r.from_entity_id]);
  }

  const chain: string[] = [];
  const seen = new Set<string>([entityId]);
  const queue = [entityId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const parent of parentsOf.get(id) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      chain.push(parent);
      queue.push(parent);
    }
  }
  return chain;
}

/**
 * Who holds `entityId` — directly, or by holding something that contains it.
 *
 * This is the rule the scheduler needed and never had. Buy booth 202 and you
 * hold suite 202, because the booth includes it. Nobody types that anywhere;
 * it follows from the sale plus the edge.
 *
 * `holdersByEntityId` is the real record of purchases (entity_balances). Passing
 * it in keeps this pure and testable — the caller does the I/O.
 *
 * Nearest holder wins: a direct hold on the suite beats one inherited from the
 * booth, so a deliberate override still works.
 */
export function holderOf(
  entityId: string,
  refs: readonly InclusionRef[],
  holdersByEntityId: ReadonlyMap<string, string>
): string | null {
  const direct = holdersByEntityId.get(entityId);
  if (direct) return direct;
  for (const container of containerChain(entityId, refs)) {
    const holder = holdersByEntityId.get(container);
    if (holder) return holder;
  }
  return null;
}
