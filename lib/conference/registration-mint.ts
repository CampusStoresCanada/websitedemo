import { resolveAssigneeForEmail } from "@/lib/actions/conference-people";
import { findExistingUserByEmail } from "@/lib/actions/conference-entity-commerce";
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

type OrderAttendeeRef = { name: string; email: string | null } | null;

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
  attendee: { name: string; email: string | null },
  seatId: string,
  itemId: string
): Promise<void> {
  let userId: string | null = null;
  let canonicalPersonId: string | null = null;
  let assignmentStatus: "assigned" | "pending_user_activation" = "assigned";
  let assignedEmailSnapshot: string | null = null;

  if (attendee.email) {
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

  const { error: seatUpdateError } = await db
    .from("entity_balance_seats")
    .update({ holder_person_id: person.id })
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
      personId: person.id,
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
            ? { name: (entry as { name: string }).name, email: (entry as { email?: string | null }).email ?? null }
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

    const { data: seats } = await db
      .from("entity_balance_seats")
      .select("id")
      .in("balance_id", balanceIds)
      .is("holder_person_id", null)
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
