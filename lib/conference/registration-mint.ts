import { resolveAssigneeForEmail } from "@/lib/actions/conference-people";
import { findExistingUserByEmail } from "@/lib/actions/conference-entity-commerce";
import { createPersonOnAddress, peopleOnAddress } from "@/lib/identity/lifecycle";
import { deriveRegistrationTier } from "./registration-tier";
import { triggerConferenceRegistrationConfirmation } from "../comms/conference-triggers";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared between the real Stripe webhook and dev-checkout (both fulfill a
 * paid order the same way) — lives outside webhook-processing.ts so calling
 * it doesn't drag in that file's Stripe-webhook-only imports (e.g. "@/lib/utils"
 * via a path vitest can't resolve for genuinely-executed, non-mocked code).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type OrderAttendeeRef = { name: string; email: string | null; contactId?: string | null } | null;

/**
 * Resolve identity + insert conference_people + allocate one seat, for one
 * attendee slot. Split out of mintRegistrationAttendeesFromOrder so that
 * function can zip N attendees to N seats instead of collapsing them into one.
 */
async function mintOneRegistrationAttendee(
  db: AdminClient,
  conferenceId: string,
  organizationId: string,
  orgName: string,
  tier: { personKind: "delegate" | "exhibitor"; tierLabel: string },
  attendee: { name: string; email: string | null; contactId?: string | null },
  seatId: string,
  itemId: string
): Promise<void> {
  let userId: string | null = null;
  let canonicalPersonId: string | null = null;
  let assignmentStatus: "assigned" | "pending_user_activation" = "assigned";
  let assignedEmailSnapshot: string | null = null;

  // ⛔ A person someone already CONFIRMED (the desk, the cart's picker) — never
  // re-matched by email, which would hand Bob's seat to Alice when they share
  // info@store.ca.
  const contactId = await personNamedForSeat(db, organizationId, attendee);
  const chosen = contactId ? await resolveChosenPerson(db, organizationId, contactId, attendee.email) : null;

  if (chosen) {
    canonicalPersonId = chosen.contactId;
    userId = chosen.userId;
    assignmentStatus = chosen.assignmentStatus;
    assignedEmailSnapshot = chosen.assignedEmailSnapshot;
  } else if (attendee.email) {
    const existingUserId = await findExistingUserByEmail(attendee.email);
    const resolved = await resolveAssigneeForEmail({
      organizationId,
      targetUserId: existingUserId,
      targetEmail: attendee.email,
    });
    if (resolved.success) {
      userId = resolved.data.targetUserId;
      canonicalPersonId = resolved.data.canonicalPersonId;
      assignmentStatus = resolved.data.assignmentStatus;
      assignedEmailSnapshot = assignmentStatus === "pending_user_activation" ? resolved.data.normalizedEmail : null;
    } else {
      console.error(
        `mintRegistrationAttendeesFromOrder: failed to resolve attendee email for order item ${itemId}: ${resolved.error}`
      );
    }
  }

  // Reuse an existing conference_people identity for this same person at
  // this conference/org if one already exists — e.g. they're already
  // seated in a different registration line in this same order, or an
  // earlier one. Minting a fresh row every single time was a real,
  // confirmed bug: the org roster resolves ONE conference_people row per
  // contact (by email), so a second registration for the same person
  // under a second, unlinked row became invisible in the roster's
  // checkbox matrix — its seat was real and correctly allocated, but
  // nothing on screen showed it as checked, because the roster's lookup
  // had already resolved that contact to the *other* row.
  let personId: string | null = null;
  if (chosen) {
    // Their own attendee row at this conference and company, by WHO they are.
    const { data: existingPerson } = await db
      .from("conference_people")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId)
      .eq("canonical_person_id", chosen.contactId)
      .limit(1)
      .maybeSingle();
    personId = existingPerson?.id ?? null;
  } else if (attendee.email) {
    const normalizedEmail = attendee.email.trim().toLowerCase();
    const { data: existingPerson } = await db
      .from("conference_people")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("organization_id", organizationId)
      .ilike("contact_email", normalizedEmail)
      .limit(1)
      .maybeSingle();
    personId = existingPerson?.id ?? null;
  }

  if (!personId) {
    const { data: person, error: personError } = await db
      .from("conference_people")
      .insert({
        conference_id: conferenceId,
        organization_id: organizationId,
        user_id: userId,
        canonical_person_id: canonicalPersonId,
        source_type: "manual",
        source_id: crypto.randomUUID(),
        person_kind: tier.personKind,
        registration_tier: tier.tierLabel,
        display_name: attendee.name,
        contact_email: attendee.email,
        assignment_status: assignmentStatus,
        assigned_email_snapshot: assignedEmailSnapshot,
        assigned_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (personError || !person) {
      console.error(
        `mintRegistrationAttendeesFromOrder: failed to create person for order item ${itemId}: ${personError?.message}`
      );
      return;
    }
    personId = person.id;
  }

  const { error: seatUpdateError } = await db
    .from("entity_balance_seats")
    .update({ holder_person_id: personId })
    .eq("id", seatId);
  if (seatUpdateError) {
    console.error(
      `mintRegistrationAttendeesFromOrder: failed to allocate seat for order item ${itemId}: ${seatUpdateError.message}`
    );
  }

  if (attendee.email) {
    await triggerConferenceRegistrationConfirmation({
      db,
      conferenceId,
      personId,
      attendeeName: attendee.name,
      attendeeEmail: attendee.email,
      orgName,
      registrationRole: tier.tierLabel,
    });
  }
}

/**
 * For a paid conference order, immediately seat any registration-kind line
 * whose cart metadata carried attendees — collected in the cart, one slot per
 * unit of quantity (see cart-client.tsx). Unlike booths, which stay
 * unassigned until the org fills seats in later via the org/slug seat matrix,
 * registrations know who they're for at purchase time — except slots left
 * "assign later," which mint as open seats exactly like a booth would.
 * Mirrors mintProspectiveRegistration's shape, just sourced from order-item
 * metadata instead of a dedicated payments table. Called from both the real
 * Stripe webhook and dev-checkout, so it stays a single source of truth for
 * "what does fulfilling a paid conference order actually do."
 */
export async function mintRegistrationAttendeesFromOrder(
  db: AdminClient,
  orderId: string,
  conferenceId: string,
  organizationId: string
): Promise<void> {
  const { data: org } = await db.from("organizations").select("name").eq("id", organizationId).single();
  const orgName = org?.name ?? "";

  const { data: items, error } = await db
    .from("conference_order_items")
    .select(
      "id, metadata, offer:conference_entities!conference_order_items_offer_entity_id_fkey(id, name, kind, attributes)"
    )
    .eq("order_id", orderId)
    .not("offer_entity_id", "is", null);
  if (error) {
    console.error(`mintRegistrationAttendeesFromOrder: failed to load order items for order ${orderId}: ${error.message}`);
    return;
  }

  for (const item of items ?? []) {
    const offer = Array.isArray(item.offer) ? item.offer[0] : item.offer;
    if (!offer || offer.kind !== "registration") continue;

    const rawAttendees = (item.metadata as { attendees?: unknown } | null)?.attendees;
    const attendees: OrderAttendeeRef[] = Array.isArray(rawAttendees)
      ? rawAttendees.map((entry) =>
          entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
            ? {
                name: (entry as { name: string }).name,
                email: (entry as { email?: string | null }).email ?? null,
                contactId: (entry as { contactId?: string | null }).contactId ?? null,
              }
            : null
        )
      : [];
    if (attendees.every((a) => !a)) continue;

    const { data: purchases } = await db.from("entity_purchases").select("id").eq("order_item_id", item.id);
    const purchaseIds = (purchases ?? []).map((p) => p.id);
    if (purchaseIds.length === 0) continue;

    const { data: balances } = await db.from("entity_balances").select("id").in("purchase_id", purchaseIds);
    const balanceIds = (balances ?? []).map((b) => b.id);
    if (balanceIds.length === 0) continue;

    /**
     * ⛔ THE REGISTRATION'S OWN SEATS, NOT EVERY SEAT THE PURCHASE CREATED.
     *
     * One registration mints more than one seat: mint_v3_for_order expands the
     * `includes` graph, so "Full Conference Registration" also lands a Meet &
     * Greet Reception seat and a Wednesday Offsite seat — all three under the
     * same purchase, and therefore all three in `balanceIds`.
     *
     * Without this filter the zip below paired the buyer's name with whichever
     * of those sorted first by `id`, which is a random uuid. Observed on
     * 2026-09-16: a quantity-1 registration seated "Scratch Probe" on the
     * RECEPTION and left the registration seat empty. badges/run.ts then skips
     * them — `if (seat.entityKind !== "registration") continue`, because a
     * badge is only ever for a registration seat — so the person a name was
     * supplied for gets no badge, and the org's roster reads as one spare
     * registration plus a reception seat held by someone unregistered.
     *
     * The included event seats are deliberately left open: they belong to the
     * org to allocate, exactly like a booth's seats do.
     *
     * ⚠️ Only reachable when a name is supplied AT PURCHASE TIME. The ordinary
     * path — the org assigning people on their own page afterwards — names a
     * specific seat and never came through here, which is why a coin-flip
     * survived this long unnoticed.
     */
    const { data: seats } = await db
      .from("entity_balance_seats")
      .select("id")
      .in("balance_id", balanceIds)
      .eq("entity_id", offer.id)
      .is("holder_person_id", null)
      // Lowest seat number first, so the same order always seats people the
      // same way. seat_index is NOT NULL (generate_series in the mint); `id`
      // only breaks ties, and on its own it is an arbitrary uuid.
      .order("seat_index")
      .order("id");
    if (!seats || seats.length === 0) continue;

    const tier = deriveRegistrationTier({
      kind: offer.kind,
      name: offer.name,
      attributes: offer.attributes as Record<string, unknown> | null,
    });

    // Zip attendee slot i to free seat i — a deferred ("assign later") slot
    // just leaves that seat open, same as a booth's seats start out.
    for (let i = 0; i < seats.length && i < attendees.length; i++) {
      const attendee = attendees[i];
      if (!attendee) continue;
      await mintOneRegistrationAttendee(db, conferenceId, organizationId, orgName, tier, attendee, seats[i].id, item.id);
    }
  }
}

/**
 * Which contact a paid seat is for, before anything is matched by email.
 *
 * The contact a human picked, when there is one. Otherwise — a cart filled
 * before the picker carried ids — by Stephen's rules
 * (project_shared_email_walkup_rules), because a seat can't wait for a human:
 *   - nobody else on the address → null, the ordinary path (unchanged);
 *   - the same name among several on it → that person;
 *   - only OTHER names on it → someone new sharing the address, with their own
 *     record and no login or Circle account. A duplicate a human can tidy is
 *     recoverable; a badge printed with someone else's name is not.
 */
export async function personNamedForSeat(
  db: AdminClient,
  organizationId: string,
  attendee: { name: string; email: string | null; contactId?: string | null }
): Promise<string | null> {
  if (attendee.contactId) return attendee.contactId;
  if (!attendee.email || !attendee.name.trim()) return null;
  const onAddress = await peopleOnAddress(db, organizationId, attendee.email, attendee.name);
  if ("error" in onAddress || onAddress.others.length === 0) return null;
  if (onAddress.sameName) return onAddress.sameName.contactId;
  const created = await createPersonOnAddress({ organizationId, name: attendee.name.trim(), email: attendee.email });
  return created.personId;
}

/**
 * A person someone already confirmed, made ready for a seat.
 *
 * ⛔ Logins and Circle accounts are ONE per email address, and whoever holds one
 * keeps it (Stephen, 2026-10-19). So:
 *   - the address already has a login → link it only if it is THIS person's;
 *   - nobody has a login, and nobody else at the company shares the address →
 *     invite them, the ordinary way;
 *   - somebody else at the company shares the address → no login, no invite:
 *     their seat and badge are their own, the account is not.
 * Returns null when the contact is not at this company, so the caller falls
 * back to the ordinary path rather than seating a stranger.
 */
export async function resolveChosenPerson(
  db: AdminClient,
  organizationId: string,
  contactId: string,
  email: string | null
): Promise<{
  contactId: string;
  userId: string | null;
  assignmentStatus: "assigned" | "pending_user_activation";
  assignedEmailSnapshot: string | null;
} | null> {
  const { data: contact } = await db
    .from("contacts")
    .select("id, profile_id, organization_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact || contact.organization_id !== organizationId) return null;

  const normalizedEmail = email?.trim().toLowerCase() || null;
  const none = { contactId, userId: null, assignmentStatus: "assigned" as const, assignedEmailSnapshot: null };
  if (!normalizedEmail) return none;

  const [existingUserId, { count: sharers }] = await Promise.all([
    findExistingUserByEmail(normalizedEmail),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .neq("id", contactId)
      .or(`work_email.eq.${normalizedEmail},email.eq.${normalizedEmail}`),
  ]);
  const alone = (sharers ?? 0) === 0;
  if (existingUserId) {
    // Theirs when it is linked to them — or when nobody else here is on the
    // address and the record is not linked to anyone yet (the online cart's
    // picker names most people this way; they must keep their own login).
    const theirs = contact.profile_id === existingUserId || (alone && !contact.profile_id);
    return { ...none, userId: theirs ? existingUserId : null };
  }
  if (!alone) return none;

  const resolved = await resolveAssigneeForEmail({
    organizationId,
    targetUserId: null,
    targetEmail: normalizedEmail,
  });
  if (!resolved.success) return none;
  return {
    contactId,
    userId: resolved.data.targetUserId,
    assignmentStatus: resolved.data.assignmentStatus,
    assignedEmailSnapshot:
      resolved.data.assignmentStatus === "pending_user_activation" ? resolved.data.normalizedEmail : null,
  };
}
