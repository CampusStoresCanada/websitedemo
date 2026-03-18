"use server";

// ─────────────────────────────────────────────────────────────────
// Chunk 24: Events — Admin check-in operations
// ─────────────────────────────────────────────────────────────────

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import type { AttendeeRow } from "@/lib/events/types";

// ── Get attendee list with check-in status ────────────────────────

export async function getCheckinList(eventId: string): Promise<
  { success: true; data: AttendeeRow[] } | { success: false; error: string }
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: regs, error } = await adminClient
    .from("event_registrations")
    .select(`
      id,
      user_id,
      status,
      registered_at,
      cancelled_at,
      checkin:event_checkins(checked_in_at),
      profile:profiles!event_registrations_user_id_fkey(display_name)
    `)
    .eq("event_id", eventId)
    .in("status", ["registered", "promoted"])
    .order("registered_at", { ascending: true });

  if (error) return { success: false, error: error.message };

  // Get auth emails for display
  const userIds = (regs ?? []).map((r: any) => r.user_id);
  let emailMap: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    emailMap = Object.fromEntries(
      (authUsers?.users ?? [])
        .filter((u) => userIds.includes(u.id))
        .map((u) => [u.id, u.email ?? ""])
    );
  }

  const rows: AttendeeRow[] = (regs ?? []).map((row: any) => ({
    registration_id: row.id,
    user_id: row.user_id,
    display_name: row.profile?.display_name ?? null,
    email: emailMap[row.user_id] ?? null,
    registration_status: row.status,
    registered_at: row.registered_at,
    cancelled_at: row.cancelled_at,
    checked_in: (row.checkin?.length ?? 0) > 0,
    checked_in_at: row.checkin?.[0]?.checked_in_at ?? null,
  }));

  return { success: true, data: rows };
}

// ── Check in an attendee ──────────────────────────────────────────

export async function checkIn(eventId: string, userId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Verify the user has a valid registration
  const { data: reg } = await adminClient
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .in("status", ["registered", "promoted"])
    .maybeSingle();

  if (!reg) return { success: false, error: "No active registration found for this attendee" };

  const { error } = await adminClient.from("event_checkins").upsert(
    {
      event_id: eventId,
      registration_id: reg.id,
      user_id: userId,
      checked_in_at: new Date().toISOString(),
      checked_in_by: auth.ctx.userId,
    },
    { onConflict: "event_id,user_id" }
  );

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.checked_in",
    entityType: "event",
    entityId: eventId,
    details: { checked_in_user: userId },
  });

  return { success: true };
}

// ── Undo check-in ─────────────────────────────────────────────────

export async function undoCheckIn(eventId: string, userId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("event_checkins")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.checkin_undone",
    entityType: "event",
    entityId: eventId,
    details: { user_id: userId },
  });

  return { success: true };
}
