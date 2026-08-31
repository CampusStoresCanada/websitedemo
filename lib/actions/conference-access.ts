"use server";

import { canManageOrganization, isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isIdentityProjectionField,
  PERSON_OBLIGATION_FIELDS,
  SELF_EDITABLE_PERSON_FIELDS,
} from "@/lib/conference/person-fields";
import {
  computePersonObligations,
  type PersonObligationFields,
  type PersonObligationStatus,
} from "@/lib/conference/access";
import type { GrantType } from "@/lib/conference/grants";
import { grantTypesForKinds } from "@/lib/conference/entity-obligations";
import { buildEntityGraph, ENTITY_SELECT } from "@/lib/conference/entity-rows";
import { resolveAccess } from "@/lib/conference/entity-commerce";

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



/** Distinct grant types implied by the kinds of seats a person occupies. */
/**
 * What a person effectively holds — following the graph, not one hop.
 *
 * ⚠️ This read the KIND of the entity each seat points at and stopped there,
 * which was wrong in a way that mattered. A Connected Exhibitor Staff
 * Registration is kind `registration`, and it `includes` twelve meals across
 * Tuesday, Wednesday and Thursday. Reading one hop saw `registration` only, so
 * `meal` never entered the set, so `meal_access` never fired — and CSC fed
 * those exhibitors twelve times without ever asking whether they could eat it.
 * Plain Exhibitor Staff Registration was the same with eight.
 *
 * The relationship was expressed correctly in the graph the whole time; the
 * resolver just did not follow it. Same shape as the seat_assigned bug that
 * checked one entity instead of every entity of its kind.
 *
 * `resolveAccess` is the walker the storefront already uses to price day
 * passes, so entitlement and obligation now come from ONE traversal at ONE
 * depth rather than two functions disagreeing about how far to look.
 */
async function loadV3HeldGrantTypes(db: AdminDb, personId: string, conferenceId: string): Promise<GrantType[]> {
  const [{ data: seats }, { data: entityRows }, { data: refRows }] = await Promise.all([
    db
      .from("entity_balance_seats")
      .select("entity_id")
      .eq("conference_id", conferenceId)
      .eq("holder_person_id", personId),
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
  ]);

  const heldIds = [...new Set((seats ?? []).map((s) => s.entity_id).filter((id): id is string => !!id))];
  if (heldIds.length === 0) return [];

  const byId = new Map(
    buildEntityGraph(entityRows ?? [], refRows ?? []).map((e) => [e.id, e])
  );

  // Held things AND everything reachable from them. The seat itself counts —
  // a directly bought Meet & Greet ticket is an `event` in its own right, not
  // something reached through an offer.
  const kinds = new Set<string>();
  for (const id of resolveAccess(heldIds, byId)) {
    const kind = byId.get(id)?.kind;
    if (kind) kinds.add(kind);
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

/**
 * The conference details this contact owes, if they're on a conference at all.
 *
 * Fetched by the contact-edit modal itself rather than threaded down through
 * MemberProfile and PartnerProfile as a prop. Editing a person is already a
 * click-and-open action, so one query at open costs nothing, and it means the
 * Conference tab appears everywhere that modal is used — both profiles, the
 * Toolkit, the person picker — without four call sites learning about
 * conference obligations.
 *
 * Returns null when this person holds nothing, which is the signal to render
 * no tab at all.
 */
export async function loadContactConferenceObligations(
  contactId: string,
  organizationId: string
): Promise<Result<{
  personId: string;
  conferenceId: string;
  fields: { key: string; label: string }[];
  missing: string[];
  values: Record<string, string | null>;
  /** False for an org admin: they see answered-or-not, never the answer. */
  canSeeValues: boolean;
} | null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, organizationId) && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized for this organization." };
  }

  /**
   * An org admin may know WHETHER their colleague has answered. They may not
   * read the answer.
   *
   * Steve, 2026-08-27: "we aren't displaying the conference information to
   * everyone, just the staff and the member". Dietary restrictions and
   * accessibility needs are health information about a named person; a manager
   * needs to know whether to chase, not what the allergy is. CSC staff running
   * the event do need the values — they are the ones telling the caterer.
   */
  const canSeeValues = isGlobalAdmin(auth.ctx.globalRole);

  const db = createAdminClient();
  // Everything this person may edit about themselves, not just what is
  // outstanding — the modal shows the whole set so someone can correct a
  // seat preference they already gave without waiting to be asked for it.
  const columns = [
    ...new Set([...PERSON_OBLIGATION_FIELDS, ...SELF_EDITABLE_PERSON_FIELDS]),
  ];
  const { data: person, error } = await db
    .from("conference_people")
    .select(`id, conference_id, ${columns.join(", ")}`)
    .eq("contact_id", contactId)
    .eq("organization_id", organizationId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!person) return { success: true, data: null };

  const row = person as unknown as { id: string; conference_id: string };
  const grantTypes = await loadV3HeldGrantTypes(db, row.id, row.conference_id);
  const status = computePersonObligations(grantTypes, person as unknown as PersonObligationFields);
  if (status.obligations.length === 0) return { success: true, data: null };

  const values: Record<string, string | null> = {};
  for (const field of columns) {
    const raw = (person as unknown as Record<string, string | null>)[field] ?? null;
    // Blanked at the SOURCE, not hidden in the component — a value that never
    // leaves the server cannot leak through a payload someone inspects.
    // Identity fields are not private; a badge name is printed on a badge.
    values[field] = canSeeValues || isIdentityProjectionField(field)
      ? raw
      : raw && raw.trim() ? "__answered__" : null;
  }

  return {
    success: true,
    data: {
      personId: row.id,
      conferenceId: row.conference_id,
      fields: status.obligations.map((o) => ({ key: o.key, label: o.label })),
      /** Outstanding right now — used to mark a field, never to hide one. */
      missing: status.missing.map((o) => o.key),
      values,
      canSeeValues,
    },
  };
}

/**
 * The signed-in person's own conference details, keyed on WHO THEY ARE.
 *
 * The org-side loader keys on (contact, organisation) because an admin is
 * looking at one specific contact row. That is the wrong key for a person
 * looking at themselves: a seat belongs to the human, and it is held through
 * whichever organisation happened to seat them. Steve holds a seat through a
 * partner org while his contact record on /me is the CSC one — keyed on
 * contact, his own details were invisible to him.
 *
 * `user_id` is also the key `updateConferencePersonSelf` guards on, so read
 * and write now agree about who the person is.
 */
export async function loadMyConferenceObligations(): Promise<Result<{
  personId: string;
  conferenceId: string;
  fields: { key: string; label: string }[];
  missing: string[];
  values: Record<string, string | null>;
  /**
   * The person's own check-ins, answered here too.
   *
   * A hotel booking is not a field — "I'm staying with family" is a complete
   * answer — but it IS a thing only this person can tell us about themselves,
   * which is the same reason dietary lives here. Collecting it somewhere else
   * because the control looks different was two ways to do one job.
   */
  checkIns: {
    taskId: string;
    name: string;
    description: string;
    state: "done" | "not_applicable" | "pending";
  }[];
  /** Exactly what a badge would say, so "check it" can show rather than ask. */
  badge: { name: string | null; title: string | null; organisation: string | null };
} | null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const columns = [
    ...new Set([...PERSON_OBLIGATION_FIELDS, ...SELF_EDITABLE_PERSON_FIELDS]),
  ];
  const { data: person, error } = await db
    .from("conference_people")
    .select(`id, conference_id, contact_id, ${columns.join(", ")}`)
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!person) return { success: true, data: null };

  const row = person as unknown as { id: string; conference_id: string; contact_id: string | null };
  const grantTypes = await loadV3HeldGrantTypes(db, row.id, row.conference_id);
  const status = computePersonObligations(grantTypes, person as unknown as PersonObligationFields);

  const values: Record<string, string | null> = {};
  for (const field of columns) {
    values[field] = (person as unknown as Record<string, string | null>)[field] ?? null;
  }

  const { loadPersonalTasks } = await import("@/lib/conference/checklist-tasks");
  const tasks = await loadPersonalTasks(db, row.conference_id, row.id);

  // The badge prints from the canonical contact, falling back to the
  // projection only where it has been deliberately set — the same precedence
  // the obligations use, so the preview cannot disagree with the print run.
  const { data: contactRow } = row.contact_id
    ? await db.from("contacts").select("name, role_title, organization_id, organizations(name)")
        .eq("id", row.contact_id).maybeSingle()
    : { data: null };
  const org = contactRow
    ? (Array.isArray((contactRow as Record<string, unknown>).organizations)
        ? ((contactRow as Record<string, unknown>).organizations as { name: string }[])[0]
        : ((contactRow as Record<string, unknown>).organizations as { name: string } | null))
    : null;
  const badgeFor = {
    name: (values.display_name as string | null) ?? contactRow?.name ?? null,
    title: contactRow?.role_title ?? null,
    organisation: org?.name ?? null,
  };

  return {
    success: true,
    data: {
      personId: row.id,
      conferenceId: row.conference_id,
      fields: status.obligations.map((o) => ({ key: o.key, label: o.label })),
      missing: status.missing.map((o) => o.key),
      values,
      badge: badgeFor,
      checkIns: tasks
        .filter((t) => t.source === "self_reported")
        .map((t) => ({
          taskId: t.taskId,
          name: t.name,
          description: t.description,
          state: t.state,
        })),
    },
  };
}
