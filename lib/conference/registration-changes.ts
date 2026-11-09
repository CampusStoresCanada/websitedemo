/**
 * Reads of conference_registration_changes, the record change_registration_offer
 * writes beside an order whose registration staff changed.
 *
 * Not in the generated types yet; the narrow cast lives here so the callers
 * stay typed.
 */

export type RegistrationChangeRecord = {
  id: string;
  from_purchase_id: string | null;
  to_purchase_id: string;
  to_entity_id: string;
};

type Filter = { id?: string; toPurchaseId?: string; conferenceId?: string; organizationId?: string };

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: string) => Query;
  order: (column: string) => Query;
  then: PromiseLike<{ data: RegistrationChangeRecord[] | null; error: { message: string } | null }>["then"];
};

export async function loadRegistrationChanges(db: unknown, filter: Filter): Promise<RegistrationChangeRecord[]> {
  let query = (db as { from: (table: string) => Query })
    .from("conference_registration_changes")
    .select("id, from_purchase_id, to_purchase_id, to_entity_id");
  if (filter.id) query = query.eq("id", filter.id);
  if (filter.toPurchaseId) query = query.eq("to_purchase_id", filter.toPurchaseId);
  if (filter.conferenceId) query = query.eq("conference_id", filter.conferenceId);
  if (filter.organizationId) query = query.eq("organization_id", filter.organizationId);
  const { data, error } = await query.order("created_at");
  if (error) throw new Error(`Could not load registration changes: ${error.message}`);
  return data ?? [];
}
