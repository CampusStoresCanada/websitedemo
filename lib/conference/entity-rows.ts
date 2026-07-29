import type {
  BuildEntity,
  EntityAttributes,
  EntityKind,
  EntityRefView,
} from "@/lib/actions/conference-entities";

/**
 * Pure row → graph mapping for the v3 catalog. Lives here (not in the
 * "use server" actions module) so non-action callers — the schedule service,
 * tests — can build the same flat `BuildEntity[]` graph without importing a
 * server-action file. The actions module imports `buildEntityGraph` from here
 * too, so there is exactly one implementation.
 */

export type RawEntityRow = {
  id: string;
  kind: string;
  name: string;
  is_for_sale: boolean;
  price_cents: number | null;
  currency: string;
  attributes: unknown;
  needs_definition: boolean;
  inventory: number | null;
  tier_prices: unknown;
  qbo_item_id: string | null;
};

export type RawRefRow = {
  from_entity_id: string;
  to_entity_id: string;
  role: string;
  quantity: number | null;
};

/** The column list every entity read selects — kept beside the row type. */
export const ENTITY_SELECT =
  "id, kind, name, is_for_sale, price_cents, currency, attributes, needs_definition, inventory, tier_prices, qbo_item_id";

/** Build the flat entity graph (entities + resolved refs) from raw rows. */
export function buildEntityGraph(
  entityRows: RawEntityRow[],
  refRows: RawRefRow[]
): BuildEntity[] {
  const meta = new Map(
    entityRows.map((r) => [r.id, { name: r.name, kind: r.kind as EntityKind }])
  );
  const refsByFrom = new Map<string, EntityRefView[]>();
  for (const r of refRows) {
    const to = meta.get(r.to_entity_id);
    if (!to) continue;
    const list = refsByFrom.get(r.from_entity_id) ?? [];
    list.push({
      toEntityId: r.to_entity_id,
      toName: to.name,
      toKind: to.kind,
      role: r.role,
      quantity: r.quantity,
    });
    refsByFrom.set(r.from_entity_id, list);
  }
  return entityRows.map((r) => ({
    id: r.id,
    kind: r.kind as EntityKind,
    name: r.name,
    isForSale: r.is_for_sale,
    priceCents: r.price_cents,
    currency: r.currency,
    attributes: (r.attributes as EntityAttributes) ?? {},
    needsDefinition: r.needs_definition,
    inventory: r.inventory,
    tierPrices: (r.tier_prices as Record<string, number>) ?? {},
    qboItemId: r.qbo_item_id,
    refs: refsByFrom.get(r.id) ?? [],
  }));
}
