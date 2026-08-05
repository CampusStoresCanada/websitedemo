import type { BuildEntity, EntityRefView } from "../actions/conference-entities";
import { RELATIONSHIP_BY_ROLE, SUGGESTION_BY_KIND } from "./entity-kinds";

/**
 * Pure graph logic for the v3 catalog — inheritance, completeness, cycle safety.
 * No I/O, so the UI, the (future) sell/fulfill resolver, and tests all share one
 * source of truth. The engine reasons over reference ROLES, never kind labels.
 */

export type EffectiveRef = EntityRefView & { inherited: boolean };

export function indexById(entities: BuildEntity[]): Map<string, BuildEntity> {
  return new Map(entities.map((e) => [e.id, e]));
}

/** The type a thing is an instance of (via the instance_of edge), if any. */
export function instanceTypeId(entity: BuildEntity): string | null {
  return entity.refs.find((r) => r.role === "instance_of")?.toEntityId ?? null;
}

/**
 * A thing's real references = its own edges, plus the edges it inherits from its
 * type (everything except instance_of), with the instance's own edges winning on
 * a given role+target. This is what makes "edit the type, instances follow" true
 * in the data — not just on screen. One level of inheritance (a type is not
 * itself expected to be an instance).
 */
export function effectiveRefs(entity: BuildEntity, byId: Map<string, BuildEntity>): EffectiveRef[] {
  const own: EffectiveRef[] = entity.refs
    .filter((r) => r.role !== "instance_of")
    .map((r) => ({ ...r, inherited: false }));

  const typeId = instanceTypeId(entity);
  const type = typeId ? byId.get(typeId) : undefined;
  if (!type) return own;

  const ownKeys = new Set(own.map((r) => `${r.role}|${r.toEntityId}`));
  const inherited: EffectiveRef[] = type.refs
    .filter((r) => r.role !== "instance_of")
    .filter((r) => !ownKeys.has(`${r.role}|${r.toEntityId}`))
    .map((r) => ({ ...r, inherited: true }));

  return [...own, ...inherited];
}

/** Just the includes edges (with quantity), inheritance applied — what gets sold/granted. */
export function effectiveIncludes(entity: BuildEntity, byId: Map<string, BuildEntity>): EffectiveRef[] {
  return effectiveRefs(entity, byId).filter((r) => r.role === "includes");
}

/**
 * A thing's effective attributes = its own attributes merged over the type's
 * attributes. Instance values win; type values are the defaults. This is what
 * makes "edit the type → instances follow" true for scalar properties too — the
 * same principle as effectiveRefs but for the attributes bag.
 */
export function effectiveAttributes(
  entity: BuildEntity,
  byId: Map<string, BuildEntity>
): Record<string, string | number | null> {
  const typeId = instanceTypeId(entity);
  const type = typeId ? byId.get(typeId) : undefined;
  if (!type) return entity.attributes;
  return { ...type.attributes, ...entity.attributes };
}

/**
 * A thing's effective QuickBooks item = its own qboItemId if set, else its
 * type's — same "instance wins, type is the default" rule as effectiveAttributes,
 * for the one field that's a real column rather than an attributes-bag key.
 * Set once on a type (e.g. "Booth") and every instance inherits it.
 */
export function effectiveQboItemId(entity: BuildEntity, byId: Map<string, BuildEntity>): string | null {
  if (entity.qboItemId) return entity.qboItemId;
  const typeId = instanceTypeId(entity);
  const type = typeId ? byId.get(typeId) : undefined;
  return type?.qboItemId ?? null;
}

/**
 * The open questions a thing still raises — the "now define what that means"
 * loop, made kind-aware. Uses EFFECTIVE refs so an instance isn't nagged for
 * something it inherits.
 */
export function openQuestions(entity: BuildEntity, byId: Map<string, BuildEntity>): string[] {
  const reasons: string[] = [];
  if (entity.needsDefinition) reasons.push("Coined on the fly — define what it is");

  const sug = SUGGESTION_BY_KIND[entity.kind];

  // computedPricing kinds (e.g. membership_renewal) are deliberately stored
  // with no price — it's computed live per-org at checkout — so "marked for
  // sale but has no price" would never be satisfiable and shouldn't nag.
  if (entity.isForSale && entity.priceCents == null && !sug?.computedPricing) {
    reasons.push("Marked for sale but has no price");
  }

  const roles = new Set(effectiveRefs(entity, byId).map((r) => r.role));
  for (const role of sug?.requiredRoles ?? []) {
    if (!roles.has(role)) reasons.push(`Missing ${RELATIONSHIP_BY_ROLE[role]?.label ?? role}`);
  }

  // Use effective (type-inherited) attributes so an instance whose value was
  // saved onto its type via "apply to all instances" isn't nagged forever —
  // and match keys case-insensitively so a required field saved under a
  // differently-cased key (e.g. "Capacity" typed to match the on-screen
  // label, vs. the canonical "capacity") is still recognized.
  const effAttrs = effectiveAttributes(entity, byId);
  const lowerAttrs = new Map(Object.entries(effAttrs).map(([k, v]) => [k.toLowerCase(), v]));

  // A policy backed by a legal document keeps its (versioned) text in the legal
  // system (conference_legal_versions), not in a `body` attribute — so it's
  // "defined" by its linked document and shouldn't be flagged as missing text.
  const legalBackedPolicy =
    entity.kind === "policy" && lowerAttrs.get("legal_document_type") != null;
  for (const key of sug?.requiredFields ?? []) {
    if (legalBackedPolicy && key === "body") continue;
    const v = lowerAttrs.get(key.toLowerCase());
    if (v === undefined || v === null || v === "") {
      reasons.push(`Missing ${sug?.fields.find((f) => f.key === key)?.label ?? key}`);
    }
  }

  // audienceGatedByCode kinds (e.g. membership_renewal) are never directly
  // purchasable — eligibility is enforced by kind + buyer tier/status in code,
  // not by a `who` ref — so "no audience" would never be satisfiable and
  // shouldn't nag.
  if (entity.isForSale && !roles.has("who") && !sug?.audienceGatedByCode) {
    reasons.push("An Offer with no audience — who can buy it?");
  }

  return reasons;
}

/**
 * Would adding an `includes` edge from→to create a loop (A includes … includes A)?
 * Pure so the write path can refuse it. `edges` is every existing includes edge
 * NOT being replaced by this write.
 */
export function wouldCycleIncludes(
  edges: ReadonlyArray<{ from: string; to: string }>,
  from: string,
  to: string
): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  // Does `to` already reach `from`? If so, from→to closes the loop.
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) stack.push(next);
  }
  return false;
}
