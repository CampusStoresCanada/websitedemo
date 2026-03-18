"use server";

// ─────────────────────────────────────────────────────────────────
// Chunk 24: Events — Self-service registration + waitlist
// ─────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { sendTransactional } from "@/lib/comms/send";
import {
  addAttendeeToCalendarEvent,
  removeAttendeeFromCalendarEvent,
} from "@/lib/google/calendar";
import type { EventRegistration, EventWaitlistEntry } from "@/lib/events/types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // Supabase returns "YYYY-MM-DD HH:mm:ss" without tz — force UTC
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(utc).toLocaleString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

// ── Register for an event ─────────────────────────────────────────

export async function registerForEvent(eventId: string): Promise<
  | { success: true; result: "registered" | "waitlisted" }
  | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const userId = auth.ctx.userId;

  // Load event
  const { data: event, error: evErr } = await adminClient
    .from("events")
    .select("id, slug, title, status, audience_mode, capacity, starts_at, google_meet_link, google_event_id, is_virtual")
    .eq("id", eventId)
    .single();

  if (evErr || !event) return { success: false, error: "Event not found" };
  if (event.status !== "published") return { success: false, error: "Event is not open for registration" };

  // Check for existing registration or waitlist entry
  const { data: existing } = await adminClient
    .from("event_registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.status === "registered" || existing.status === "promoted") {
      return { success: false, error: "Already registered for this event" };
    }
    if (existing.status === "waitlisted") {
      return { success: false, error: "Already on the waitlist for this event" };
    }
    // Was cancelled — allow re-registration below (will upsert)
  }

  const { data: wlExisting } = await adminClient
    .from("event_waitlist")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (wlExisting) return { success: false, error: "Already on the waitlist for this event" };

  // Check capacity
  let atCapacity = false;
  if (event.capacity !== null) {
    const { count } = await adminClient
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .in("status", ["registered", "promoted"]);
    atCapacity = (count ?? 0) >= event.capacity;
  }

  if (atCapacity) {
    // Add to waitlist
    const { data: lastPos } = await adminClient
      .from("event_waitlist")
      .select("position")
      .eq("event_id", eventId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = (lastPos?.position ?? 0) + 1;

    const { error: wlErr } = await adminClient.from("event_waitlist").insert({
      event_id: eventId,
      user_id: userId,
      position: nextPosition,
    });

    if (wlErr) return { success: false, error: wlErr.message };

    await logAuditEventSafe({
      actorId: userId,
      action: "event.waitlisted",
      entityType: "event",
      entityId: eventId,
      details: { position: nextPosition },
    });

    return { success: true, result: "waitlisted" };
  }

  // Register directly
  const { error: regErr } = await adminClient
    .from("event_registrations")
    .upsert(
      { event_id: eventId, user_id: userId, status: "registered", registered_at: new Date().toISOString(), cancelled_at: null },
      { onConflict: "event_id,user_id" }
    );

  if (regErr) return { success: false, error: regErr.message };

  await logAuditEventSafe({
    actorId: userId,
    action: "event.registered",
    entityType: "event",
    entityId: eventId,
    details: {},
  });

  // Send confirmation email + Google Calendar invite — both non-fatal
  void (async () => {
    const userEmail = auth.ctx.userEmail;
    if (!userEmail) return;

    // Add to Google Calendar event so they receive a proper calendar invite
    if (event.is_virtual && event.google_event_id) {
      addAttendeeToCalendarEvent(event.google_event_id, userEmail).catch((e) => {
        console.error("[event-registration] calendar invite failed:", e);
      });
    }

    try {
      const profileRes = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();

      const meetLinkBlock = event.google_meet_link
        ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${event.google_meet_link}" style="color:#EE2A2E;">${event.google_meet_link}</a></p>`
        : "";

      await sendTransactional({
        templateKey: "event_registration_confirmation",
        to: userEmail,
        variables: {
          registrant_name: profileRes.data?.display_name ?? "there",
          event_title: event.title,
          event_date: fmtDate(event.starts_at),
          event_url: `${APP_URL}/events/${event.slug}`,
          meet_link_block: meetLinkBlock,
        },
      });
    } catch (e) {
      console.error("[event-registration] confirmation email failed:", e);
    }
  })();

  return { success: true, result: "registered" };
}

// ── Cancel registration ───────────────────────────────────────────

export async function cancelRegistration(eventId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const userId = auth.ctx.userId;

  const { data: cancelEvent } = await adminClient
    .from("events")
    .select("google_event_id, is_virtual")
    .eq("id", eventId)
    .single();

  const { data: reg } = await adminClient
    .from("event_registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!reg) {
    // Check if on waitlist instead
    const { data: wl } = await adminClient
      .from("event_waitlist")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle();

    if (wl) {
      await adminClient.from("event_waitlist").delete().eq("id", wl.id);
      // Reorder remaining positions
      await reorderWaitlist(eventId);
      return { success: true };
    }

    return { success: false, error: "No registration found for this event" };
  }

  if (reg.status === "cancelled") {
    return { success: false, error: "Registration is already cancelled" };
  }

  // Cancel the registration
  const { error } = await adminClient
    .from("event_registrations")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", reg.id);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    actorId: userId,
    action: "event.registration_cancelled",
    entityType: "event",
    entityId: eventId,
    details: {},
  });

  // Remove from Google Calendar event — non-fatal
  const userEmail = auth.ctx.userEmail;
  if (userEmail && cancelEvent?.is_virtual && cancelEvent?.google_event_id) {
    removeAttendeeFromCalendarEvent(cancelEvent.google_event_id, userEmail).catch((e) => {
      console.error("[event-registration] calendar remove attendee failed:", e);
    });
  }

  // Promote next person from waitlist
  await promoteFromWaitlist(eventId);

  return { success: true };
}

// ── Waitlist promotion (internal) ─────────────────────────────────

async function promoteFromWaitlist(eventId: string): Promise<void> {
  const adminClient = createAdminClient();

  // Get next person in line
  const { data: nextInLine } = await adminClient
    .from("event_waitlist")
    .select("id, user_id, position")
    .eq("event_id", eventId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextInLine) return;

  // Promote: insert/upsert registration, mark promoted_at on waitlist entry
  const now = new Date().toISOString();

  const { error: regErr } = await adminClient
    .from("event_registrations")
    .upsert(
      {
        event_id: eventId,
        user_id: nextInLine.user_id,
        status: "promoted",
        registered_at: now,
        cancelled_at: null,
      },
      { onConflict: "event_id,user_id" }
    );

  if (regErr) return;

  // Update waitlist entry promoted_at then delete
  await adminClient
    .from("event_waitlist")
    .update({ promoted_at: now })
    .eq("id", nextInLine.id);

  await adminClient.from("event_waitlist").delete().eq("id", nextInLine.id);

  // Reorder remaining waitlist positions
  await reorderWaitlist(eventId);

  // Notify the promoted user — non-fatal
  void (async () => {
    try {
      const { data: event } = await adminClient
        .from("events")
        .select("id, slug, title, starts_at, google_meet_link")
        .eq("id", eventId)
        .single();

      if (!event) return;

      const { data: authUser } = await adminClient.auth.admin.getUserById(nextInLine.user_id);
      const userEmail = authUser?.user?.email;
      if (!userEmail) return;

      const { data: profile } = await adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", nextInLine.user_id)
        .maybeSingle();

      const meetLinkBlock = event.google_meet_link
        ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${event.google_meet_link}" style="color:#6366f1;">${event.google_meet_link}</a></p>`
        : "";

      await sendTransactional({
        templateKey: "event_waitlist_promoted",
        to: userEmail,
        variables: {
          registrant_name: profile?.display_name ?? "there",
          event_title: event.title,
          event_date: fmtDate(event.starts_at),
          event_url: `${APP_URL}/events/${event.slug}`,
          meet_link_block: meetLinkBlock,
        },
      });
    } catch (e) {
      console.error("[event-registration] waitlist promotion email failed:", e);
    }
  })();
}

async function reorderWaitlist(eventId: string): Promise<void> {
  const adminClient = createAdminClient();

  const { data: entries } = await adminClient
    .from("event_waitlist")
    .select("id")
    .eq("event_id", eventId)
    .order("position", { ascending: true });

  if (!entries?.length) return;

  await Promise.all(
    entries.map((entry, idx) =>
      adminClient
        .from("event_waitlist")
        .update({ position: idx + 1 })
        .eq("id", entry.id)
    )
  );
}

// ── Get my registration for an event ─────────────────────────────

export async function getMyRegistration(eventId: string): Promise<
  | { success: true; data: EventRegistration | null; waitlistPosition: number | null }
  | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const userId = auth.ctx.userId;

  const [{ data: reg }, { data: wl }] = await Promise.all([
    adminClient
      .from("event_registrations")
      .select("*")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle(),
    adminClient
      .from("event_waitlist")
      .select("position")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    success: true,
    data: (reg as EventRegistration | null) ?? null,
    waitlistPosition: wl?.position ?? null,
  };
}

// ── Org admin: register a member from their org ───────────────────

/**
 * Returns org members who are NOT yet registered for the event.
 * Caller must be an org_admin of the given orgId.
 */
export async function getOrgMembersEligibleForEvent(
  eventId: string,
  orgId: string
): Promise<
  | { success: true; data: { user_id: string; display_name: string | null }[] }
  | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.ctx.orgAdminOrgIds.includes(orgId)) {
    return { success: false, error: "Not an org admin for this organization" };
  }

  const adminClient = createAdminClient();

  // Already-registered user IDs
  const { data: regs } = await adminClient
    .from("event_registrations")
    .select("user_id")
    .eq("event_id", eventId)
    .in("status", ["registered", "promoted"]);
  const registeredIds = new Set((regs ?? []).map((r: any) => r.user_id));

  // Members of the org (user_organizations → auth.users, no direct profiles FK)
  const { data: members, error } = await adminClient
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  const userIds = (members ?? []).map((m: any) => m.user_id);
  if (userIds.length === 0) return { success: true, data: [] };

  // Batch-fetch display names from profiles
  const { data: profileRows } = await adminClient
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const nameMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.display_name ?? null]));

  const eligible = userIds
    .filter((uid) => !registeredIds.has(uid) && uid !== auth.ctx.userId)
    .map((uid) => ({ user_id: uid, display_name: nameMap.get(uid) ?? null }));

  return { success: true, data: eligible };
}

/**
 * Org admin registers one or more members from their org. Complimentary.
 * Fires calendar invite + confirmation email for each, same as self-registration.
 */
export async function orgAdminRegisterMembers(
  eventId: string,
  targetUserIds: string[],
  orgId: string
): Promise<{ success: true; registered: number; skipped: number } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.ctx.orgAdminOrgIds.includes(orgId)) {
    return { success: false, error: "Not an org admin for this organization" };
  }
  if (targetUserIds.length === 0) return { success: false, error: "No members selected" };

  const adminClient = createAdminClient();

  // Load event
  const { data: event } = await adminClient
    .from("events")
    .select("id, slug, title, status, is_virtual, starts_at, google_event_id, google_meet_link")
    .eq("id", eventId)
    .single();

  if (!event || event.status !== "published") {
    return { success: false, error: "Event is not open for registration" };
  }

  // Verify all targets are in the org
  const { data: memberships } = await adminClient
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .in("user_id", targetUserIds);
  const orgMemberIds = new Set((memberships ?? []).map((m: any) => m.user_id));

  // Already registered
  const { data: existingRegs } = await adminClient
    .from("event_registrations")
    .select("user_id, id, status")
    .eq("event_id", eventId)
    .in("user_id", targetUserIds);
  const existingMap = new Map((existingRegs ?? []).map((r: any) => [r.user_id, r]));

  // Fetch emails + names for post-registration hooks
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const emailMap = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]));
  const { data: profileRows } = await adminClient.from("profiles").select("id, display_name").in("id", targetUserIds);
  const nameMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.display_name ?? null]));

  let registered = 0;
  let skipped = 0;

  for (const userId of targetUserIds) {
    if (!orgMemberIds.has(userId)) { skipped++; continue; }

    const existing = existingMap.get(userId);
    if (existing && (existing.status === "registered" || existing.status === "promoted")) {
      skipped++;
      continue;
    }

    if (existing) {
      await adminClient
        .from("event_registrations")
        .update({ status: "registered", cancelled_at: null })
        .eq("id", existing.id);
    } else {
      await adminClient.from("event_registrations").insert({
        event_id: eventId,
        user_id: userId,
        status: "registered",
        registered_at: new Date().toISOString(),
        amount_paid_cents: 0,
        payment_status: "free",
      });
    }

    registered++;

    // Fire calendar + email — non-fatal
    void (async () => {
      const userEmail = emailMap.get(userId);
      if (!userEmail) return;

      if (event.is_virtual && event.google_event_id) {
        addAttendeeToCalendarEvent(event.google_event_id, userEmail).catch((e) => {
          console.error("[org-reg] calendar invite failed:", e);
        });
      }

      try {
        const meetLinkBlock = event.google_meet_link
          ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${event.google_meet_link}" style="color:#EE2A2E;">${event.google_meet_link}</a></p>`
          : "";

        await sendTransactional({
          templateKey: "event_registration_confirmation",
          to: userEmail,
          variables: {
            registrant_name: nameMap.get(userId) ?? "there",
            event_title: event.title,
            event_date: fmtDate(event.starts_at),
            event_url: `${APP_URL}/events/${event.slug}`,
            meet_link_block: meetLinkBlock,
          },
        });
      } catch (e) {
        console.error("[org-reg] confirmation email failed:", e);
      }
    })();
  }

  revalidatePath(`/events/${event.slug}`, "page");
  return { success: true, registered, skipped };
}

// ── Attendees for event creator ───────────────────────────────────

/**
 * Returns the full attendee list for an event the caller created.
 * No email addresses — names + reg status + check-in only.
 */
export async function getAttendeesForCreator(
  eventId: string
): Promise<
  | { success: true; data: { user_id: string; display_name: string | null; registration_status: string; registered_at: string; checked_in: boolean; checked_in_at: string | null }[] }
  | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Verify caller is the event creator
  const { data: ev } = await adminClient
    .from("events")
    .select("created_by")
    .eq("id", eventId)
    .single();

  if (!ev) return { success: false, error: "Event not found" };
  if (ev.created_by !== auth.ctx.userId) return { success: false, error: "Not authorized" };

  const { data: regs, error } = await adminClient
    .from("event_registrations")
    .select("user_id, status, registered_at")
    .eq("event_id", eventId)
    .in("status", ["registered", "promoted", "cancelled"])
    .order("registered_at", { ascending: true });

  if (error) return { success: false, error: error.message };

  const userIds = (regs ?? []).map((r: any) => r.user_id);

  // Two-step: fetch profiles + checkins in parallel
  const [profileResult, checkinResult] = await Promise.all([
    userIds.length > 0
      ? adminClient.from("profiles").select("id, display_name").in("id", userIds)
      : Promise.resolve({ data: [] }),
    adminClient.from("event_checkins").select("user_id, checked_in_at").eq("event_id", eventId).in("user_id", userIds.length > 0 ? userIds : [""]),
  ]);

  const nameMap = new Map((profileResult.data ?? []).map((p: any) => [p.id, p.display_name ?? null]));
  const checkinMap = new Map<string, string | null>();
  for (const c of checkinResult.data ?? []) checkinMap.set(c.user_id, c.checked_in_at);

  return {
    success: true,
    data: (regs ?? []).map((r: any) => ({
      user_id: r.user_id,
      display_name: nameMap.get(r.user_id) ?? null,
      registration_status: r.status,
      registered_at: r.registered_at,
      checked_in: checkinMap.has(r.user_id),
      checked_in_at: checkinMap.get(r.user_id) ?? null,
    })),
  };
}

// ── Admin: eligible members for event registration picker ─────────

/**
 * Returns users eligible to be manually registered for an event:
 * - Org members from the event creator's org first (scoped, relevant)
 * - Global admins also see all platform users
 * - Already-registered (non-cancelled) users are excluded
 */
export async function getEligibleMembersForEvent(
  eventId: string
): Promise<
  | { success: true; data: { user_id: string; display_name: string | null; email: string | null; org_name: string | null }[] }
  | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const { isGlobalAdmin } = await import("@/lib/auth/guards");
  const adminClient = createAdminClient();

  // Get event + creator's org
  const { data: ev } = await adminClient
    .from("events")
    .select("created_by")
    .eq("id", eventId)
    .single();

  if (!ev) return { success: false, error: "Event not found" };

  // Already-registered user IDs (exclude from picker)
  const { data: regs } = await adminClient
    .from("event_registrations")
    .select("user_id")
    .eq("event_id", eventId)
    .in("status", ["registered", "promoted"]);
  const registeredIds = new Set((regs ?? []).map((r: any) => r.user_id));

  // Find creator's org(s)
  let creatorOrgIds: string[] = [];
  if (ev.created_by) {
    const { data: memberships } = await adminClient
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", ev.created_by);
    creatorOrgIds = (memberships ?? []).map((m: any) => m.organization_id);
  }

  // Fetch org members + org names (two-step: user_organizations → auth.users, no direct profiles FK)
  let orgRows: { user_id: string; org_name: string | null; display_name: string | null }[] = [];
  if (creatorOrgIds.length > 0) {
    const { data: members } = await adminClient
      .from("user_organizations")
      .select("user_id, organizations!inner(name)")
      .in("organization_id", creatorOrgIds) as { data: any[] | null };

    const orgUserIds = (members ?? []).map((m: any) => m.user_id);
    const { data: profileRows } = await adminClient
      .from("profiles")
      .select("id, display_name")
      .in("id", orgUserIds);
    const nameMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.display_name ?? null]));

    orgRows = (members ?? []).map((m: any) => ({
      user_id: m.user_id,
      org_name: Array.isArray(m.organizations) ? (m.organizations[0]?.name ?? null) : (m.organizations?.name ?? null),
      display_name: nameMap.get(m.user_id) ?? null,
    }));
  }

  // If global admin, also pull all other profiles not already in org list
  const orgUserIds = new Set(orgRows.map((r) => r.user_id));
  let allRows: { user_id: string; org_name: string | null; display_name: string | null }[] = [...orgRows];

  if (isGlobalAdmin(auth.ctx.globalRole)) {
    const { data: allProfiles } = await adminClient
      .from("profiles")
      .select("id, display_name")
      .order("display_name", { ascending: true })
      .limit(500) as { data: any[] | null };
    for (const p of allProfiles ?? []) {
      if (!orgUserIds.has(p.id)) {
        allRows.push({ user_id: p.id, org_name: null, display_name: p.display_name ?? null });
      }
    }
  }

  // Fetch emails for everyone
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const emailMap = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? null]));

  // Filter out already-registered
  const result = allRows
    .filter((r) => !registeredIds.has(r.user_id))
    .map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      email: emailMap.get(r.user_id) ?? null,
      org_name: r.org_name,
    }));

  return { success: true, data: result };
}

// ── Admin: register a specific user for an event ──────────────────

/**
 * Admin-only: register a user by userId. Complimentary — bypasses payment.
 */
export async function adminRegisterUser(
  eventId: string,
  userId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const { isGlobalAdmin } = await import("@/lib/auth/guards");
  const adminClient = createAdminClient();

  const { data: ev } = await adminClient
    .from("events")
    .select("created_by")
    .eq("id", eventId)
    .single();

  if (!ev) return { success: false, error: "Event not found" };

  const callerIsAdmin = isGlobalAdmin(auth.ctx.globalRole);
  const callerIsCreator = ev.created_by === auth.ctx.userId;
  if (!callerIsAdmin && !callerIsCreator) return { success: false, error: "Not authorized" };

  const { data: existing } = await adminClient
    .from("event_registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing && (existing.status === "registered" || existing.status === "promoted")) {
    return { success: false, error: "User is already registered for this event" };
  }

  if (existing) {
    await adminClient
      .from("event_registrations")
      .update({ status: "registered", cancelled_at: null })
      .eq("id", existing.id);
  } else {
    await adminClient.from("event_registrations").insert({
      event_id: eventId,
      user_id: userId,
      status: "registered",
      registered_at: new Date().toISOString(),
      amount_paid_cents: 0,
      payment_status: "complimentary",
    });
  }

  revalidatePath(`/admin/events/${eventId}`, "page");
  return { success: true };
}

// ── List my registrations (all events) ───────────────────────────

export async function listMyRegistrations(): Promise<
  | {
      success: true;
      data: Array<{ event: { id: string; slug: string; title: string; starts_at: string; status: string }; registration: EventRegistration }>;
    }
  | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("event_registrations")
    .select(`*, event:events(id, slug, title, starts_at, status)`)
    .eq("user_id", auth.ctx.userId)
    .neq("status", "cancelled")
    .order("registered_at", { ascending: false });

  if (error) return { success: false, error: error.message };

  return {
    success: true,
    data: (data ?? []).map((row: any) => ({
      event: row.event,
      registration: {
        id: row.id,
        event_id: row.event_id,
        user_id: row.user_id,
        status: row.status,
        registered_at: row.registered_at,
        cancelled_at: row.cancelled_at,
      },
    })),
  };
}
