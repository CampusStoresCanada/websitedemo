"use server";

import { canManageOrganization, isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computePersonObligations,
  type PersonObligationFields,
  type PersonObligationStatus,
} from "@/lib/conference/access";
import type { GrantType } from "@/lib/conference/grants";
import { grantTypesForKinds } from "@/lib/conference/entity-obligations";

/**
 * Conference fulfillment obligations — derived from a person's v3 holdings.
 *
 * The data a person owes (name, dietary, emergency contact…) follows from the
 * kinds of seats allocated to them (entity_balance_seats → conference_entities
 * → grant types → DataObligations). The legacy grant_balances resolver was
 * retired with Fork B. See docs/CONFERENCE_V2_BLUEPRINT.md.
 */

type AdminDb = ReturnType<typeof createAdminClient>;
type Result<T> = { success: true; data: T } | { success: false; error: string };

const PERSON_OBLIGATION_FIELDS = [
  "display_name",
  "contact_email",
  "dietary_restrictions",
  "accessibility_needs",
  "emergency_contact_name",
  "emergency_contact_phone",
] as const;

/** Distinct grant types implied by the kinds of seats a person occupies. */
async function loadV3HeldGrantTypes(db: AdminDb, personId: string, conferenceId: string): Promise<GrantType[]> {
  const { data } = await db
    .from("entity_balance_seats")
    .select("entity:conference_entities!entity_balance_seats_entity_id_fkey(kind)")
    .eq("conference_id", conferenceId)
    .eq("holder_person_id", personId);
  const kinds = new Set<string>();
  for (const row of data ?? []) {
    const entity = Array.isArray(row.entity) ? row.entity[0] : row.entity;
    if (entity?.kind) kinds.add(entity.kind);
  }
  return grantTypesForKinds(kinds);
}

/**
 * Bulk obligations for every active person-row in a conference (optionally one
 * organization), keyed by conference_people.id. Each person's obligations come
 * from the kinds of v3 seats allocated to them; people with no seats owe nothing.
 */
export async function resolveConferenceObligations(
  conferenceId: string,
  organizationId?: string
): Promise<Result<Map<string, PersonObligationStatus>>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (organizationId) {
    if (!canManageOrganization(auth.ctx, organizationId) && !isGlobalAdmin(auth.ctx.globalRole)) {
      return { success: false, error: "Not authorized for this organization." };
    }
  } else if (!isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Admin access required." };
  }

  const db = createAdminClient();

  let query = db
    .from("conference_people")
    .select(`id, assignment_status, ${PERSON_OBLIGATION_FIELDS.join(", ")}`)
    .eq("conference_id", conferenceId)
    .neq("assignment_status", "canceled");
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data: rows, error: rowsError } = await query;
  if (rowsError) return { success: false, error: rowsError.message };

  const people = (rows ?? []) as unknown as Array<{ id: string } & PersonObligationFields>;
  const personIds = people.map((p) => p.id);

  // Grant types per person, from the kinds of seats they hold.
  const grantTypesByPerson = new Map<string, Set<GrantType>>();
  if (personIds.length > 0) {
    const { data: seats, error: seatsError } = await db
      .from("entity_balance_seats")
      .select("holder_person_id, entity:conference_entities!entity_balance_seats_entity_id_fkey(kind)")
      .eq("conference_id", conferenceId)
      .in("holder_person_id", personIds);
    if (seatsError) return { success: false, error: seatsError.message };
    for (const s of seats ?? []) {
      if (!s.holder_person_id) continue;
      const entity = Array.isArray(s.entity) ? s.entity[0] : s.entity;
      if (!entity?.kind) continue;
      const set = grantTypesByPerson.get(s.holder_person_id) ?? new Set<GrantType>();
      for (const g of grantTypesForKinds([entity.kind])) set.add(g);
      grantTypesByPerson.set(s.holder_person_id, set);
    }
  }

  const result = new Map<string, PersonObligationStatus>();
  for (const person of people) {
    const grantTypes = [...(grantTypesByPerson.get(person.id) ?? [])];
    result.set(person.id, computePersonObligations(grantTypes, person as PersonObligationFields));
  }
  return { success: true, data: result };
}

export async function resolvePersonObligations(
  personId: string,
  conferenceId: string
): Promise<Result<PersonObligationStatus>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const { data: person, error: personError } = await db
    .from("conference_people")
    .select(`user_id, organization_id, ${PERSON_OBLIGATION_FIELDS.join(", ")}`)
    .eq("id", personId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (personError) return { success: false, error: personError.message };
  if (!person) return { success: false, error: "Person not found." };

  // The person themselves, their org's managers, or a global admin.
  const row = person as unknown as { user_id: string | null; organization_id: string | null };
  const isOwner = row.user_id === auth.ctx.userId;
  const managesOrg = row.organization_id ? canManageOrganization(auth.ctx, row.organization_id) : false;
  if (!isOwner && !managesOrg && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to view this person's readiness." };
  }

  const grantTypes = await loadV3HeldGrantTypes(db, personId, conferenceId);
  const fields = person as unknown as PersonObligationFields;
  return { success: true, data: computePersonObligations(grantTypes, fields) };
}
