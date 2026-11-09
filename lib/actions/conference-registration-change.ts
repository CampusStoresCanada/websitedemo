"use server";

/**
 * Staff: change a held registration to another one at the same price, such as
 * a Tuesday Day Pass to a Wednesday one (York University, 2026-11-09).
 *
 * The rule for what it may become is registrationChangeTargets; the change
 * itself is one database function (change_registration_offer). The person on
 * the seat stays on it. Afterwards their roster label follows the new
 * registration and they are seated in what it includes, exactly as naming
 * them to it would have done (allocateSeat). Then they get their registration
 * confirmation again, showing the new one, and the buyer on the order gets an
 * updated receipt (Steve, 2026-11-09).
 *
 * ⛔ Staff only. An org can buy the wrong thing; only CSC changes what it holds.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { loadSeatHoldings, type SeatHolding } from "@/lib/conference/seats";
import { seatIncludedEvents } from "@/lib/conference/included-seats";
import { deriveRegistrationTier } from "@/lib/conference/registration-tier";
import {
  registrationChangeErrorMessage,
  registrationChangeTargets,
  type RegistrationChangeTarget,
} from "@/lib/conference/registration-change";
import { getProgramsConfig, resolveConferenceTier } from "@/lib/policy/engine";
import { loadRegistrationChanges } from "@/lib/conference/registration-changes";
import {
  triggerConferenceOrderUpdated,
  triggerConferenceRegistrationConfirmation,
} from "@/lib/comms/conference-triggers";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export type RegistrationChangeRow = {
  seatId: string;
  organizationId: string;
  organizationName: string;
  holderName: string | null;
  currentEntityId: string;
  currentName: string;
  paidUnitCents: number;
  targets: RegistrationChangeTarget[];
};

type Db = ReturnType<typeof createAdminClient>;

// ⛔ PostgREST rejects an `.in()` much past 200 ids; read in slices.
async function inChunks<T>(ids: string[], read: (slice: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await read(ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

/** Every held registration that could be changed, with what it could become. */
async function loadRows(db: Db, conferenceId: string, onlySeatId?: string): Promise<RegistrationChangeRow[]> {
  const { seats: allRegistrations, entitiesById } = await loadSeatHoldings(db, {
    conferenceId,
    entityKinds: ["registration"],
  });
  const soldByEntity = new Map<string, number>();
  for (const seat of allRegistrations) soldByEntity.set(seat.entityId, (soldByEntity.get(seat.entityId) ?? 0) + 1);

  const seats = onlySeatId ? allRegistrations.filter((s) => s.seatId === onlySeatId) : allRegistrations;
  const withBalance = seats.filter((s): s is SeatHolding & { balanceId: string } => Boolean(s.balanceId));
  if (withBalance.length === 0) return [];

  const balances = await inChunks(
    [...new Set(withBalance.map((s) => s.balanceId))],
    (slice) => db.from("entity_balances").select("id, purchase_id").in("id", slice)
  );
  const purchaseByBalance = new Map(balances.map((b) => [b.id as string, b.purchase_id as string | null]));
  const purchases = await inChunks(
    [...new Set([...purchaseByBalance.values()].filter((id): id is string => Boolean(id)))],
    (slice) => db.from("entity_purchases").select("id, price_cents").in("id", slice)
  );
  const priceByPurchase = new Map(purchases.map((p) => [p.id as string, (p.price_cents as number | null) ?? 0]));

  const orgs = await inChunks(
    [...new Set(withBalance.map((s) => s.organizationId).filter(Boolean))],
    (slice) => db.from("organizations").select("id, name, type").in("id", slice)
  );
  const programs = await getProgramsConfig();
  const orgById = new Map(
    orgs.map((o) => [o.id as string, { name: o.name as string, tier: resolveConferenceTier((o.type as string | null) ?? null, programs) }])
  );

  const rows: RegistrationChangeRow[] = [];
  for (const seat of withBalance) {
    const org = orgById.get(seat.organizationId);
    const purchaseId = purchaseByBalance.get(seat.balanceId);
    if (!org || !purchaseId) continue;
    const paidUnitCents = priceByPurchase.get(purchaseId) ?? 0;
    const targets = registrationChangeTargets({
      fromEntityId: seat.entityId,
      paidUnitCents,
      buyerTier: org.tier,
      byId: entitiesById,
      soldByEntity,
    });
    if (targets.length === 0) continue;
    rows.push({
      seatId: seat.seatId,
      organizationId: seat.organizationId,
      organizationName: org.name,
      holderName: seat.holderName,
      currentEntityId: seat.entityId,
      currentName: seat.entityName,
      paidUnitCents,
      targets,
    });
  }
  return rows.sort(
    (a, b) => a.organizationName.localeCompare(b.organizationName) || (a.holderName ?? "").localeCompare(b.holderName ?? "")
  );
}

/**
 * The order a purchase was paid on. A change's purchase has no order line of
 * its own, so a change of a change is followed back to the first purchase.
 */
async function orderForPurchase(db: Db, purchaseId: string): Promise<string | null> {
  let current: string | null = purchaseId;
  for (let hop = 0; current && hop < 20; hop += 1) {
    const { data: purchase } = await db.from("entity_purchases").select("order_item_id").eq("id", current).maybeSingle();
    if (purchase?.order_item_id) {
      const { data: item } = await db
        .from("conference_order_items")
        .select("order_id")
        .eq("id", purchase.order_item_id)
        .maybeSingle();
      return (item?.order_id as string | undefined) ?? null;
    }
    const [earlier] = await loadRegistrationChanges(db, { toPurchaseId: current });
    current = earlier?.from_purchase_id ?? null;
  }
  return null;
}

async function notifyRegistrationChange(
  db: Db,
  change: {
    conferenceId: string;
    changeId: string;
    holderId: string | null;
    organizationName: string;
    fromName: string;
    toEntityId: string;
    toName: string;
  }
): Promise<void> {
  try {
    let holderName: string | null = null;
    if (change.holderId) {
      const { data: person } = await db
        .from("conference_people")
        .select("display_name, contact_email")
        .eq("id", change.holderId)
        .maybeSingle();
      holderName = (person?.display_name as string | null) ?? null;
      const email = (person?.contact_email as string | null)?.trim();
      if (email) {
        const { data: entity } = await db
          .from("conference_entities")
          .select("kind, name, attributes")
          .eq("id", change.toEntityId)
          .single();
        await triggerConferenceRegistrationConfirmation({
          db,
          conferenceId: change.conferenceId,
          personId: change.holderId,
          attendeeName: holderName ?? email,
          attendeeEmail: email,
          orgName: change.organizationName,
          registrationRole: entity
            ? deriveRegistrationTier({ kind: entity.kind, name: entity.name, attributes: entity.attributes as Record<string, unknown> | null }).tierLabel
            : change.toName,
          triggerEventKey: `conference_registration_confirmation:${change.holderId}:change:${change.changeId}`,
        });
      }
    }

    const [row] = await loadRegistrationChanges(db, { id: change.changeId });
    const orderId = row?.from_purchase_id ? await orderForPurchase(db, row.from_purchase_id) : null;
    if (orderId) {
      await triggerConferenceOrderUpdated({
        db,
        orderId,
        changeId: change.changeId,
        changeSentence: `${holderName ?? "Your unassigned ticket"} is now on the ${change.toName} instead of the ${change.fromName}.`,
      });
    }
  } catch (error) {
    console.error("[registration-change] could not send the change emails:", error);
  }
}

/** Staff: the registrations that can be changed, and to what. */
export async function getRegistrationChangeRows(conferenceId: string): Promise<Result<RegistrationChangeRow[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    return { success: true, data: await loadRows(createAdminClient(), conferenceId) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Staff: change one held registration to another at the same price. */
export async function changeRegistration(params: {
  conferenceId: string;
  seatId: string;
  toEntityId: string;
}): Promise<Result<{ fromName: string; toName: string; holderName: string | null }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  let row: RegistrationChangeRow | undefined;
  try {
    row = (await loadRows(db, params.conferenceId, params.seatId))[0];
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  const target = row?.targets.find((t) => t.id === params.toEntityId);
  if (!row || !target) {
    return { success: false, error: "That ticket can't be changed to that registration: it must be one they could buy, at the price they paid." };
  }

  // Not in the generated types yet; same narrow cast the other new RPCs use.
  const rpc = db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc.call(db, "change_registration_offer", {
    p_conference_id: params.conferenceId,
    p_seat_id: row.seatId,
    p_to_entity_id: target.id,
    p_actor_id: auth.ctx.userId,
    p_reason: "staff_registration_change",
  });
  if (error) return { success: false, error: registrationChangeErrorMessage(error.message) };

  const result = (data ?? {}) as { change_id?: string; holder_person_id?: string | null };
  const holderId = result.holder_person_id ?? null;
  if (holderId) {
    // What naming them to the new registration would have done (allocateSeat).
    const { data: entity } = await db
      .from("conference_entities")
      .select("kind, name, attributes")
      .eq("id", target.id)
      .single();
    if (entity) {
      const tier = deriveRegistrationTier({
        kind: entity.kind,
        name: entity.name,
        attributes: entity.attributes as Record<string, unknown> | null,
      });
      const { error: personError } = await db
        .from("conference_people")
        .update({ person_kind: tier.personKind, registration_tier: tier.tierLabel })
        .eq("id", holderId);
      if (personError) console.warn("[registration-change] roster label not updated:", personError.message);
    }
    await seatIncludedEvents(db, params.conferenceId, row.seatId, holderId);
  }

  // The person on the ticket gets their registration again, and whoever paid
  // gets the updated receipt. A failed email never undoes the change: both
  // are recorded in the comms log either way (triggerAutomation).
  if (result.change_id) {
    await notifyRegistrationChange(db, {
      conferenceId: params.conferenceId,
      changeId: result.change_id,
      holderId,
      organizationName: row.organizationName,
      fromName: row.currentName,
      toEntityId: target.id,
      toName: target.name,
    });
  }

  await logAuditEventSafe({
    action: "conference_registration_changed",
    entityType: "organization",
    entityId: row.organizationId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: params.conferenceId,
      seatId: row.seatId,
      changeId: result.change_id ?? null,
      holderPersonId: holderId,
      from: row.currentName,
      to: target.name,
      priceCents: row.paidUnitCents,
    },
  });
  revalidatePath(`/admin/conference/${params.conferenceId}/registrations`);
  return { success: true, data: { fromName: row.currentName, toName: target.name, holderName: row.holderName } };
}
