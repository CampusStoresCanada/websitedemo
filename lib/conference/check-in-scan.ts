/**
 * THE check-in scan: a QR code in, a check-in state out.
 *
 * ⛔ One engine for every route that checks someone in — the desk, an event
 * door, a self check-in kiosk, an attendee's own phone. Same token reader,
 * same day rule, same agreements, same writes. The routes differ only in WHO
 * pressed the button (`actor`), and that is recorded on the person
 * (`check_in_source = 'self'`) and the audit row, never inferred later.
 *
 * Callers authorise first: the desk with requireConferenceDeskAccess, a phone
 * with the token itself plus the conference's self check-in settings
 * (lib/actions/self-check-in.ts). This module checks nothing about the caller.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { findBadgeTokenRow } from "@/lib/conference/badges/tokens";
import { personOwedAgreements, type OwedAgreement } from "@/lib/conference/legal-acceptance";
import { personReachesEntity, personVerdictToday } from "@/lib/conference/badges/checkin";
import { conferenceToday } from "@/lib/conference/desk-staff";
import type { SelfCheckInRoute } from "@/lib/conference/self-check-in";

export type CheckInScanResultState =
  | "valid"
  | "already_checked_in"
  | "invalid_token"
  | "revoked_token"
  | "not_found"
  | "legal_not_accepted"
  /** Their badge does not cover today. Refused at pickup — see verdictForDay. */
  | "not_valid_today"
  /**
   * At an event's door: the event is not in their access. Let in and invoiced
   * (enforcement off by default) — the desk offers the sale.
   */
  | "not_on_ticket";

/**
 * Who is checking them in. `desk`: staff, signed in. `kiosk`: the attendee, on
 * a staff device in self check-in mode (userId is the staff member whose
 * device it is). `phone`: the attendee on their own phone, maybe signed out.
 */
export type CheckInActor = { route: "desk" | SelfCheckInRoute; userId: string | null };

export async function runCheckInScan(params: {
  conferenceId: string;
  qrToken: string;
  scanTimestamp?: string | null;
  deviceId?: string | null;
  /**
   * A desk rehearsal. The scan runs for real — same token resolution, same
   * gates, same writes — and every row it creates is flagged so it can be found
   * and undone later. ⛔ NOT a dry run: the point is to exercise the true path,
   * which means the cleanup has to live in the data rather than in whoever
   * remembers they were testing.
   */
  testMode?: boolean;
  /** Rehearsal only: pretend it is this date (YYYY-MM-DD). Ignored otherwise. */
  asOf?: string | null;
  /**
   * The event this device is checking people in to (lib/conference/door.ts),
   * or null for badge pickup. ⛔ A door asks "is this event in their access?",
   * never the desk's day rule.
   */
  entityId?: string | null;
  /** Who is checking them in. See CheckInActor. */
  actor: CheckInActor;
}): Promise<{
  success: boolean;
  error?: string;
  data?: {
    state: CheckInScanResultState;
    personId: string | null;
    checkedInAt: string | null;
    /** `legal_not_accepted`: what they must accept at the desk, with the text. */
    owed?: OwedAgreement[];
  };
}> {
  const actor = params.actor;
  // ⛔ A self check-in is badge pickup only: an event door is staffed.
  const selfService = actor.route !== "desk";

  const conferenceId = params.conferenceId;
  const token = params.qrToken.trim();
  const deviceId = params.deviceId?.trim() || null;
  const scannedAt = params.scanTimestamp
    ? new Date(params.scanTimestamp).toISOString()
    : new Date().toISOString();
  const db = createAdminClient();

  const isTest = params.testMode === true;
  // The door's event must be one of this conference's events — the id comes
  // from the browser.
  let doorEntityId: string | null = null;
  if (params.entityId && !selfService) {
    const { data: doorEntity } = await db
      .from("conference_entities")
      .select("id")
      .eq("id", params.entityId)
      .eq("conference_id", conferenceId)
      .eq("kind", "event")
      .maybeSingle();
    if (!doorEntity) return { success: false, error: "That event is not part of this conference." };
    doorEntityId = doorEntity.id as string;
  }
  const insertEvent = async (
    state: CheckInScanResultState,
    personId: string | null,
    scanTokenId: string | null,
    entityId: string | null = doorEntityId
  ) => {
    await db.from("conference_check_in_events").insert({
      conference_id: conferenceId,
      person_id: personId,
      checked_in_at: scannedAt,
      checked_in_by: actor.userId,
      // ⛔ Still "qr". `is_test` is a separate axis: a rehearsal scan is still a
      // scan, and folding the two together would lose how the person was
      // checked in for every row in a test run.
      check_in_source: "qr",
      scan_token_id: scanTokenId,
      device_id: deviceId,
      result_state: state,
      is_test: isTest,
      entity_id: entityId,
    });
  };

  if (!token) {
    await insertEvent("invalid_token", null, null);
    return {
      success: true,
      data: { state: "invalid_token", personId: null, checkedInAt: null },
    };
  }

  // One reader for conference_badge_tokens — see findBadgeTokenRow. The desk and
  // the /scan route hashed the same token separately before this, which is how
  // two answers to "is this badge valid" get to drift apart.
  const tokenRow = await findBadgeTokenRow(db, { token, conferenceId });

  let resolvedTokenRow = tokenRow;
  if (!resolvedTokenRow) {
    // Immutable v1 token model: QR payload can be the conference_people UUID directly.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(token)) {
      await insertEvent("invalid_token", null, null);
      return {
        success: true,
        data: { state: "invalid_token", personId: null, checkedInAt: null },
      };
    }

    const { data: personByUuid, error: personByUuidError } = await db
      .from("conference_people")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("id", token)
      .maybeSingle();
    if (personByUuidError || !personByUuid) {
      await insertEvent("invalid_token", null, null);
      return {
        success: true,
        data: { state: "invalid_token", personId: null, checkedInAt: null },
      };
    }

    const { data: ensuredTokenRows, error: ensureTokenError } = await db.rpc(
      "ensure_conference_badge_token_for_person",
      {
        p_conference_id: conferenceId,
        p_person_id: token,
        p_actor_id: actor.userId ?? undefined,
      }
    );
    if (ensureTokenError || !Array.isArray(ensuredTokenRows) || ensuredTokenRows.length === 0) {
      return {
        success: false,
        error: ensureTokenError?.message ?? "Failed to ensure badge token for UUID payload.",
      };
    }

    const ensuredTokenId = (ensuredTokenRows[0] as { token_id: string }).token_id;
    const { data: tokenById, error: tokenByIdError } = await db
      .from("conference_badge_tokens")
      .select("id, person_id, conference_id, revoked_at")
      .eq("id", ensuredTokenId)
      .maybeSingle();
    if (tokenByIdError || !tokenById) {
      return {
        success: false,
        error: tokenByIdError?.message ?? "Failed to resolve ensured token row.",
      };
    }
    resolvedTokenRow = tokenById;
  }

  if (!resolvedTokenRow) {
    await insertEvent("invalid_token", null, null);
    return {
      success: true,
      data: { state: "invalid_token", personId: null, checkedInAt: null },
    };
  }

  if (resolvedTokenRow.revoked_at) {
    await insertEvent("revoked_token", resolvedTokenRow.person_id, resolvedTokenRow.id);
    return {
      success: true,
      data: { state: "revoked_token", personId: resolvedTokenRow.person_id, checkedInAt: null },
    };
  }

  const { data: personRow, error: personError } = await db
    .from("conference_people")
    .select("id, checked_in_at, assignment_status")
    .eq("conference_id", conferenceId)
    .eq("id", resolvedTokenRow.person_id)
    .maybeSingle();

  if (personError) {
    return { success: false, error: `Failed to load conference person: ${personError.message}` };
  }

  if (!personRow || personRow.assignment_status === "canceled") {
    await insertEvent("not_found", resolvedTokenRow.person_id, resolvedTokenRow.id);
    return {
      success: true,
      data: { state: "not_found", personId: resolvedTokenRow.person_id, checkedInAt: null },
    };
  }

  // Picking up a badge: the conference check-in itself. Shared by the desk and
  // by a door (a badge in hand at a door is a badge already picked up).
  const checkInToConference = async (): Promise<{ checkedInAt: string } | { error: string }> => {
    const at = new Date().toISOString();
    const { error: updateError } = await db
      .from("conference_people")
      .update({ checked_in_at: at, check_in_source: selfService ? "self" : "badge_pickup", check_in_is_test: isTest, updated_at: at })
      .eq("id", personRow.id);
    if (updateError) return { error: `Failed to set check-in state: ${updateError.message}` };
    return { checkedInAt: at };
  };

  // ── At an event's door ────────────────────────────────────────────────
  if (doorEntityId) {
    // In already? A re-entry is not counted twice.
    const { data: prior, error: priorError } = await db
      .from("conference_check_in_events")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("person_id", personRow.id)
      .eq("entity_id", doorEntityId)
      .in("result_state", ["valid", "not_on_ticket"])
      .limit(1);
    if (priorError) return { success: false, error: priorError.message };
    if ((prior ?? []).length > 0) {
      await insertEvent("already_checked_in", personRow.id, resolvedTokenRow.id);
      return {
        success: true,
        data: { state: "already_checked_in", personId: personRow.id, checkedInAt: personRow.checked_in_at },
      };
    }

    // ⚠️ If what they hold cannot be read, let them in: a database hiccup must
    // not stop the line at a reception.
    const reaches = await personReachesEntity(conferenceId, personRow.id, doorEntityId).catch(() => true);

    // ⛔ A badge scanned at a door also checks them in to the conference
    // (Stephen, 2026-10-20) — and no day rule here: a Thursday-only holder who
    // bought the Tuesday reception is let in.
    let conferenceCheckedInAt = personRow.checked_in_at as string | null;
    if (!conferenceCheckedInAt) {
      const done = await checkInToConference();
      if ("error" in done) return { success: false, error: done.error };
      conferenceCheckedInAt = done.checkedInAt;
      await insertEvent("valid", personRow.id, resolvedTokenRow.id, null);
    }

    const state: CheckInScanResultState = reaches ? "valid" : "not_on_ticket";
    await insertEvent(state, personRow.id, resolvedTokenRow.id);
    await logAuditEventSafe({
      action: "conference_door_scan",
      entityType: "conference_people",
      entityId: personRow.id,
      actorId: actor.userId,
      actorType: actor.userId ? "user" : "system",
      details: { conferenceId, eventEntityId: doorEntityId, resultState: state, deviceId, isTest },
    });
    return { success: true, data: { state, personId: personRow.id, checkedInAt: conferenceCheckedInAt } };
  }

  if (personRow.checked_in_at) {
    await insertEvent("already_checked_in", personRow.id, resolvedTokenRow.id);
    return {
      success: true,
      data: {
        state: "already_checked_in",
        personId: personRow.id,
        checkedInAt: personRow.checked_in_at,
      },
    };
  }

  // ⛔ A DAY GATE, deliberately — unlike documents below. A Thursday day pass
  // picked up on Tuesday is refused, red, and nothing is checked in (Stephen,
  // 2026-10-19). Same rule the desk card shows (verdictForDay), judged on the
  // conference's own date. ⚠️ If what the badge covers cannot be read, the scan
  // goes through: a database hiccup must not stop the queue.
  const today =
    isTest && params.asOf && /^\d{4}-\d{2}-\d{2}$/.test(params.asOf)
      ? params.asOf
      : await conferenceToday(conferenceId);
  const verdict = await personVerdictToday(conferenceId, personRow.id, today).catch(() => null);
  if (verdict && !verdict.admitted) {
    await insertEvent("not_valid_today", personRow.id, resolvedTokenRow.id);
    return {
      success: true,
      data: { state: "not_valid_today", personId: personRow.id, checkedInAt: null },
    };
  }

  // ⛔ AGREEMENTS ARE COLLECTED HERE (Stephen, 2026-10-23): "if we haven't
  // gotten them to do it by the time they are at the door, that is our last
  // shot." Not a refusal: the desk shows what they owe, they read and accept
  // on the desk's device (acceptAgreementsAtDesk), and the scan runs again.
  // The 2026-09-08 removal was right that turning people away makes the queue
  // a paperwork desk; collecting consent on the spot does not.
  // ⚠️ If what they owe cannot be read, the scan goes through: a database
  // hiccup must not stop the queue (same rule as the day check above).
  const owed = await personOwedAgreements(createAdminClient(), conferenceId, personRow.id).catch(() => []);
  if (owed.length > 0) {
    await insertEvent("legal_not_accepted", personRow.id, resolvedTokenRow.id);
    return {
      success: true,
      data: { state: "legal_not_accepted", personId: personRow.id, checkedInAt: null, owed },
    };
  }

  const done = await checkInToConference();
  if ("error" in done) return { success: false, error: done.error };
  const checkedInAt = done.checkedInAt;

  await insertEvent("valid", personRow.id, resolvedTokenRow.id);
  await logAuditEventSafe({
    action: "conference_check_in_scan",
    entityType: "conference_people",
    entityId: personRow.id,
    actorId: actor.userId,
    actorType: actor.userId ? "user" : "system",
    details: {
      conferenceId,
      scanTokenId: resolvedTokenRow.id,
      resultState: "valid",
      checkedInAt,
      deviceId,
      isTest,
      route: actor.route,
    },
  });

  return {
    success: true,
    data: { state: "valid", personId: personRow.id, checkedInAt },
  };
}
