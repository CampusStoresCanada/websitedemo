"use server";

/**
 * The check-in desk PIN, on the server. See lib/conference/desk-pin.ts for the
 * rules. Every action works on the SIGNED-IN person's own PIN, except
 * clearDeskPin, which an admin uses on someone else's.
 */

import {
  isGlobalAdmin,
  requireAuthenticated,
  requireConferenceDeskAccess,
  signedInRecently,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { afterWrongPin, deskPinChangeAllowed, deskPinMatches, hashDeskPin, isValidDeskPin } from "@/lib/conference/desk-pin";

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Does this person have a PIN yet, and may they choose one without the old? */
export async function getDeskPinState(
  conferenceId: string
): Promise<Result<{ hasPin: boolean; mayResetWithoutPin: boolean }>> {
  const auth = await requireConferenceDeskAccess(conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  const { data, error } = await createAdminClient()
    .from("desk_pins")
    .select("profile_id")
    .eq("profile_id", auth.ctx.userId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  return { success: true, data: { hasPin: Boolean(data), mayResetWithoutPin: signedInRecently(auth.ctx) } };
}

/**
 * Set (or change) your own PIN.
 *
 * ⛔ Needs the current PIN, OR a password sign-in in the last 15 minutes (see
 * deskPinChangeAllowed) — even for a first PIN, so a lockout is never a reset.
 * A long-lived session is not enough.
 */
export async function setDeskPin(params: {
  conferenceId: string;
  pin: string;
  currentPin?: string | null;
}): Promise<Result<null>> {
  const auth = await requireConferenceDeskAccess(params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  if (!isValidDeskPin(params.pin)) return { success: false, error: "A PIN is 4 to 6 digits." };

  const db = createAdminClient();
  const { data: existing, error } = await db
    .from("desk_pins")
    .select("pin_hash")
    .eq("profile_id", auth.ctx.userId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  const currentPinOk = Boolean(
    existing && params.currentPin && deskPinMatches(params.currentPin, existing.pin_hash as string)
  );
  if (!deskPinChangeAllowed({ currentPinOk, signedInRecently: signedInRecently(auth.ctx) })) {
    return { success: false, error: "Sign in with your password again to choose a desk PIN." };
  }

  const { error: writeError } = await db.from("desk_pins").upsert({
    profile_id: auth.ctx.userId,
    pin_hash: hashDeskPin(params.pin),
    failed_attempts: 0,
    updated_at: new Date().toISOString(),
  });
  if (writeError) return { success: false, error: writeError.message };
  await logAuditEventSafe({
    action: existing ? "desk_pin_changed" : "desk_pin_set",
    entityType: "desk_pin",
    entityId: auth.ctx.userId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { conferenceId: params.conferenceId },
  });
  return { success: true, data: null };
}

/**
 * Check your own PIN — to come back from hand-over, or to approve an invoice.
 * On the fifth wrong try the PIN is cleared and `lockedOut` comes back: the
 * desk signs out, and a password sign-in lets them set a new one.
 */
export async function verifyDeskPin(params: {
  conferenceId: string;
  pin: string;
}): Promise<Result<{ ok: boolean; attemptsLeft: number; lockedOut: boolean }>> {
  const auth = await requireConferenceDeskAccess(params.conferenceId);
  if (!auth.ok) return { success: false, error: auth.error };
  const db = createAdminClient();
  const { data: row, error } = await db
    .from("desk_pins")
    .select("pin_hash, failed_attempts")
    .eq("profile_id", auth.ctx.userId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!row) return { success: true, data: { ok: false, attemptsLeft: 0, lockedOut: true } };

  if (deskPinMatches(params.pin, row.pin_hash as string)) {
    if ((row.failed_attempts as number) > 0) {
      await db.from("desk_pins").update({ failed_attempts: 0 }).eq("profile_id", auth.ctx.userId);
    }
    return { success: true, data: { ok: true, attemptsLeft: 5, lockedOut: false } };
  }

  const next = afterWrongPin(row.failed_attempts as number);
  if (next.lockedOut) {
    await db.from("desk_pins").delete().eq("profile_id", auth.ctx.userId);
    await logAuditEventSafe({
      action: "desk_pin_locked_out",
      entityType: "desk_pin",
      entityId: auth.ctx.userId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { conferenceId: params.conferenceId },
    });
  } else {
    await db.from("desk_pins").update({ failed_attempts: next.failed }).eq("profile_id", auth.ctx.userId);
  }
  return { success: true, data: { ok: false, attemptsLeft: next.left, lockedOut: next.lockedOut } };
}

/**
 * An admin clears someone's PIN (from the conference's Desk staff list); they
 * set a new one the next time they open the desk.
 */
export async function clearDeskPin(params: { conferenceId: string; profileId: string }): Promise<Result<null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!isGlobalAdmin(auth.ctx.globalRole)) return { success: false, error: "Administrator access required" };
  const { error } = await createAdminClient().from("desk_pins").delete().eq("profile_id", params.profileId);
  if (error) return { success: false, error: error.message };
  await logAuditEventSafe({
    action: "desk_pin_cleared",
    entityType: "desk_pin",
    entityId: params.profileId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { conferenceId: params.conferenceId },
  });
  return { success: true, data: null };
}
