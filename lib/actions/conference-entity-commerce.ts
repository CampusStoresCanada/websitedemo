"use server";

import crypto from "node:crypto";
import { canManageOrganization, isGlobalAdmin, requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EntityKind } from "@/lib/actions/conference-entities";
import { resolveAssigneeForEmail } from "@/lib/actions/conference-people";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { deriveRegistrationTier } from "../conference/registration-tier";
import { buildEntityGraph, ENTITY_SELECT } from "../conference/entity-rows";
import { indexById } from "../conference/entity-graph";
import { findOverlappingRegistration } from "../conference/registration-overlap";
import { findUserByEmail } from "../supabase/find-user-by-email";

/**
 * v3 fulfill — the read/allocate side. The buy-side (cart → checkout → mint)
 * runs through the real order path (createConferenceCheckout + the
 * mint_v3_for_order RPC inside process_conference_order_paid). This file holds
 * the access resolver and org seat allocation. See blueprint §6d.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export type AccessThing = { id: string; name: string; kind: EntityKind };

/** Resolve reachable entity ids (minus what's held) into named things to attend. */
async function namedAccess(
  db: ReturnType<typeof createAdminClient>,
  reachableIds: string[],
  heldIds: Set<string>
): Promise<Result<AccessThing[]>> {
  if (reachableIds.length === 0) return { success: true, data: [] };
  const { data: entities, error } = await db
    .from("conference_entities")
    .select("id, name, kind")
    .in("id", reachableIds);
  if (error) return { success: false, error: error.message };
  const things: AccessThing[] = (entities ?? [])
    .filter((e) => !heldIds.has(e.id)) // what they get INTO, not what they hold
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind as EntityKind }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { success: true, data: things };
}

/** What a real person (conference_people) can get into — the fulfillment resolver. */
export async function resolvePersonAccess(conferenceId: string, personId: string): Promise<Result<AccessThing[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: rows, error } = await db.rpc("resolve_person_access", { p_conference_id: conferenceId, p_person_id: personId });
  if (error) return { success: false, error: error.message };

  const { data: held } = await db
    .from("entity_balance_seats")
    .select("entity_id")
    .eq("conference_id", conferenceId)
    .eq("holder_person_id", personId);
  const heldIds = new Set((held ?? []).map((h) => h.entity_id));
  return namedAccess(db, (rows ?? []).map((r) => r.entity_id), heldIds);
}

// ─────────────────────────────────────────────────────────────────
// B4: org-scoped allocation — assign minted SEATS to attendees
// ─────────────────────────────────────────────────────────────────

export type OrgEntitySeat = {
  id: string;
  entityId: string;
  name: string;
  kind: EntityKind;
  seatIndex: number;
  holderPersonId: string | null;
  holderName: string | null;
};

/** Every allocatable seat an org holds for a conference, with who (if anyone) sits in it. */
export async function listEntitySeatsForOrg(
  conferenceId: string,
  organizationId: string
): Promise<Result<OrgEntitySeat[]>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, organizationId) && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const db = createAdminClient();
  const { data: rows, error } = await db
    .from("entity_balance_seats")
    .select("id, entity_id, seat_index, holder_person_id")
    .eq("conference_id", conferenceId)
    .eq("organization_id", organizationId)
    .order("entity_id")
    .order("seat_index");
  if (error) return { success: false, error: error.message };

  const entityIds = [...new Set((rows ?? []).map((r) => r.entity_id))];
  const personIds = [...new Set((rows ?? []).map((r) => r.holder_person_id).filter((id): id is string => Boolean(id)))];
  const [{ data: entities }, { data: people }] = await Promise.all([
    entityIds.length
      ? db.from("conference_entities").select("id, name, kind").in("id", entityIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; kind: string }> }),
    personIds.length
      ? db.from("conference_people").select("id, display_name").in("id", personIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null }> }),
  ]);
  const entityById = new Map((entities ?? []).map((e) => [e.id, e]));
  const personById = new Map((people ?? []).map((p) => [p.id, p]));

  const seats: OrgEntitySeat[] = (rows ?? []).map((s) => {
    const entity = entityById.get(s.entity_id);
    return {
      id: s.id,
      entityId: s.entity_id,
      name: entity?.name ?? "",
      kind: (entity?.kind ?? "") as EntityKind,
      seatIndex: s.seat_index,
      holderPersonId: s.holder_person_id,
      holderName: s.holder_person_id ? personById.get(s.holder_person_id)?.display_name ?? null : null,
    };
  });
  return { success: true, data: seats };
}

/** Seat one of an org's attendees in a seat it holds — derives their badge tier from the seat's entity. */
export async function allocateSeat(
  seatId: string,
  personId: string
): Promise<Result<{ warning: string | null }>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: seat, error: seatErr } = await db
    .from("entity_balance_seats")
    .select("conference_id, organization_id, entity_id")
    .eq("id", seatId)
    .single();
  if (seatErr || !seat) return { success: false, error: seatErr?.message ?? "Seat not found." };
  if (!seat.organization_id || (!canManageOrganization(auth.ctx, seat.organization_id) && !isGlobalAdmin(auth.ctx.globalRole))) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const { data: person, error: personErr } = await db
    .from("conference_people")
    .select("conference_id, organization_id")
    .eq("id", personId)
    .single();
  if (personErr || !person) return { success: false, error: personErr?.message ?? "Person not found." };
  if (person.conference_id !== seat.conference_id) {
    return { success: false, error: "That person isn't in this conference." };
  }
  if (person.organization_id !== seat.organization_id) {
    return { success: false, error: "That person belongs to a different organization." };
  }

  const { data: entity, error: entityErr } = await db
    .from("conference_entities")
    .select("kind, name, attributes")
    .eq("id", seat.entity_id)
    .single();
  if (entityErr || !entity) return { success: false, error: entityErr?.message ?? "Seat's entity not found." };
  const tier = deriveRegistrationTier({
    kind: entity.kind,
    name: entity.name,
    attributes: entity.attributes as Record<string, unknown> | null,
  });

  // Warn (don't block) if this person already holds another registration that
  // covers a day this seat's entity also covers — e.g. a Full Conference
  // Registration already includes Wednesday, so also assigning a Wednesday
  // Day Pass is redundant. Checked before writing so the warning reflects
  // what's about to change, not a seat that's already allocated.
  let warning: string | null = null;
  if (entity.kind === "registration") {
    const [{ data: otherSeats }, entitiesRes, refsRes] = await Promise.all([
      db
        .from("entity_balance_seats")
        .select("entity_id")
        .eq("conference_id", seat.conference_id)
        .eq("holder_person_id", personId)
        .neq("id", seatId),
      db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", seat.conference_id),
      db.from("conference_entity_refs").select("from_entity_id, to_entity_id, role, quantity").eq("conference_id", seat.conference_id),
    ]);
    const byId = indexById(buildEntityGraph(entitiesRes.data ?? [], refsRes.data ?? []));
    const otherHeldEntityIds = (otherSeats ?? []).map((s) => s.entity_id);
    const overlap = findOverlappingRegistration(seat.entity_id, otherHeldEntityIds, byId);
    if (overlap.overlapping) {
      warning = `This person already holds "${overlap.conflictingEntityName}", which already covers the same day as "${entity.name}" — you may want to fix this assignment.`;
    }
  }

  // Guard against two concurrent assigns racing for the same seat — without
  // the .is() filter, whichever update lands second would silently bump the
  // first assignee with no error to either caller.
  const { data: updatedSeat, error: seatUpdateError } = await db
    .from("entity_balance_seats")
    .update({ holder_person_id: personId })
    .eq("id", seatId)
    .is("holder_person_id", null)
    .select("id");
  if (seatUpdateError) return { success: false, error: seatUpdateError.message };
  if (!updatedSeat || updatedSeat.length === 0) {
    return { success: false, error: "This seat was just assigned to someone else — refresh and try again." };
  }

  const { error: personUpdateError } = await db
    .from("conference_people")
    .update({ person_kind: tier.personKind, registration_tier: tier.tierLabel })
    .eq("id", personId);
  if (personUpdateError) return { success: false, error: personUpdateError.message };

  return { success: true, data: { warning } };
}

/** Empty a seat — clears the freed person's derived tier back to unassigned. */
export async function deallocateSeat(seatId: string): Promise<Result<null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: seat, error: seatErr } = await db
    .from("entity_balance_seats")
    .select("organization_id, holder_person_id")
    .eq("id", seatId)
    .single();
  if (seatErr || !seat) return { success: false, error: seatErr?.message ?? "Seat not found." };
  if (!seat.organization_id || (!canManageOrganization(auth.ctx, seat.organization_id) && !isGlobalAdmin(auth.ctx.globalRole))) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const { error } = await db.from("entity_balance_seats").update({ holder_person_id: null }).eq("id", seatId);
  if (error) return { success: false, error: error.message };

  if (seat.holder_person_id) {
    await db
      .from("conference_people")
      .update({ person_kind: "unassigned", registration_tier: null })
      .eq("id", seat.holder_person_id);
  }

  return { success: true, data: null };
}

// ─────────────────────────────────────────────────────────────────
// Attendees — the people an org can seat. conference_people is a projection;
// registration/staff rows are synced into it, but an org can also add a person
// directly (source_type "manual"). The full registration-intake model is a
// later island; this just gives seats someone to be allocated to.
// ─────────────────────────────────────────────────────────────────

/** Does this email already belong to a platform user? Same lookup inviteOrgUser() does internally. */
export async function findExistingUserByEmail(email: string): Promise<string | null> {
  const adminDb = createAdminClient();
  const match = await findUserByEmail(adminDb, email);
  return match?.id ?? null;
}

/**
 * Add a person to a conference for an org, so seats can be allocated to
 * them. Starts as person_kind "unassigned" — allocateSeat() derives their
 * real kind/tier from whichever seat they end up in, so there's no manual
 * guessing before a seat is even chosen. A walk-in with just a name is
 * immediately "assigned" — there's nothing pending for them. An email
 * matching an existing platform user is linked immediately. A new email is
 * invited via resolveAssigneeForEmail(), parked as pending_user_activation
 * until that person logs in.
 */
export async function addConferenceAttendee(
  conferenceId: string,
  organizationId: string,
  attendee: { displayName: string; contactEmail: string | null }
): Promise<Result<{ id: string; assignmentStatus: "assigned" | "pending_user_activation"; invited: boolean }>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!canManageOrganization(auth.ctx, organizationId) && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const name = attendee.displayName.trim();
  if (!name) return { success: false, error: "Name is required." };
  const trimmedEmail = attendee.contactEmail?.trim() || null;

  let userId: string | null = null;
  let assignmentStatus: "assigned" | "pending_user_activation" = "assigned";
  let canonicalPersonId: string | null = null;
  let assignedEmailSnapshot: string | null = null;

  if (trimmedEmail) {
    const existingUserId = await findExistingUserByEmail(trimmedEmail);
    const resolved = await resolveAssigneeForEmail({
      organizationId,
      targetUserId: existingUserId,
      targetEmail: trimmedEmail,
    });
    if (!resolved.success) return { success: false, error: resolved.error };
    userId = resolved.data.targetUserId;
    assignmentStatus = resolved.data.assignmentStatus;
    canonicalPersonId = resolved.data.canonicalPersonId;
    assignedEmailSnapshot = assignmentStatus === "pending_user_activation" ? resolved.data.normalizedEmail : null;
  }

  const db = createAdminClient();

  // Reuse an existing conference_people row for this same person at this
  // conference/org, if one already exists — e.g. they're already seated in
  // a different registration line. Inserting unconditionally every call was
  // a real, confirmed bug (same flaw already fixed in
  // mintOneRegistrationAttendee, lib/conference/registration-mint.ts): the
  // org roster resolves one conference_people row per contact by email, so
  // a second, unlinked duplicate row's seat became invisible in the
  // checkbox matrix even though it was really allocated. Only possible when
  // there's an email to match on — a name-only walk-in still always inserts
  // fresh, matching the shipped fix's same limitation.
  if (trimmedEmail) {
    const { data: existing } = await db
      .from("conference_people")
      .select("id, assignment_status")
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId)
      .ilike("contact_email", trimmedEmail)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        success: true,
        data: {
          id: existing.id,
          assignmentStatus: existing.assignment_status as "assigned" | "pending_user_activation",
          invited: false,
        },
      };
    }
  }

  const { data, error } = await db
    .from("conference_people")
    .insert({
      conference_id: conferenceId,
      organization_id: organizationId,
      user_id: userId,
      canonical_person_id: canonicalPersonId,
      source_type: "manual",
      source_id: crypto.randomUUID(),
      person_kind: "unassigned",
      display_name: name,
      contact_email: trimmedEmail,
      assignment_status: assignmentStatus,
      assigned_email_snapshot: assignedEmailSnapshot,
      assigned_at: new Date().toISOString(),
      assigned_by: auth.ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Failed to add attendee." };

  return {
    success: true,
    data: { id: data.id, assignmentStatus, invited: assignmentStatus === "pending_user_activation" },
  };
}

/** Remove a manually added attendee (frees any seats they hold first). */
export async function removeConferenceAttendee(personId: string): Promise<Result<null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: person, error: personErr } = await db
    .from("conference_people")
    .select("organization_id, source_type")
    .eq("id", personId)
    .single();
  if (personErr || !person) return { success: false, error: personErr?.message ?? "Person not found." };
  if (!person.organization_id || (!canManageOrganization(auth.ctx, person.organization_id) && !isGlobalAdmin(auth.ctx.globalRole))) {
    return { success: false, error: "Not authorized for this organization." };
  }
  if (person.source_type !== "manual") {
    return { success: false, error: "Only manually added attendees can be removed here." };
  }

  await db.from("entity_balance_seats").update({ holder_person_id: null }).eq("holder_person_id", personId);
  const { error } = await db.from("conference_people").delete().eq("id", personId);
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "conference_attendee_removed",
    entityType: "conference_people",
    entityId: personId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { organizationId: person.organization_id },
  });

  return { success: true, data: null };
}
