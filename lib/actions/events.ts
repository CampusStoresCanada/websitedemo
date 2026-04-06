"use server";

// ─────────────────────────────────────────────────────────────────
// Chunk 24: Events — Admin CRUD + status transitions
// ─────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { requireAuthenticated, requireAdmin, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUTC } from "@/lib/utils";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { createCalendarEventWithMeet, deleteCalendarEvent } from "@/lib/google/calendar";
import { triggerAutomation } from "@/lib/comms/automation";
import { sendTransactional } from "@/lib/comms/send";
import { buildEventActionUrls } from "@/lib/email/eventActionTokens";
import type {
  Event,
  EventWithMeta,
  EventWithOrgContext,
  CreateEventPayload,
  UpdateEventPayload,
  EventStatus,
  EVENT_STATUS_TRANSITIONS,
} from "@/lib/events/types";
import { EVENT_STATUS_TRANSITIONS as TRANSITIONS } from "@/lib/events/types";

// ── Slug generation ───────────────────────────────────────────────

/** Auto-register the event creator as a host (free, no ticket type). Non-fatal. */
async function registerCreatorAsHost(eventId: string, userId: string): Promise<void> {
  const adminClient = createAdminClient();
  await adminClient.from("event_registrations").insert({
    event_id: eventId,
    user_id: userId,
    status: "registered",
    registered_at: new Date().toISOString(),
    amount_paid_cents: 0,
    payment_status: "free",
  });
}

function generateSlug(title: string, startsAt: string): string {
  const date = new Date(startsAt).toISOString().slice(0, 10); // YYYY-MM-DD
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) +
    "-" +
    date
  );
}

// ── List events (admin) ───────────────────────────────────────────

export async function listEvents(filters?: {
  status?: EventStatus;
  created_by?: string;
  from?: string;
  to?: string;
}): Promise<{ success: true; data: EventWithMeta[] } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  let query = adminClient
    .from("events")
    .select("*")
    .order("starts_at", { ascending: true });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.created_by) query = query.eq("created_by", filters.created_by);
  if (filters?.from) query = query.gte("starts_at", filters.from);
  if (filters?.to) query = query.lte("starts_at", filters.to);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };

  const rows = data ?? [];

  // Fetch registration + waitlist counts
  const eventIds = rows.map((r) => r.id);
  const [regResult, wlResult, profilesResult] = await Promise.all([
    eventIds.length
      ? adminClient.from("event_registrations").select("event_id").in("event_id", eventIds).eq("status", "registered")
      : Promise.resolve({ data: [] as { event_id: string }[], error: null }),
    eventIds.length
      ? adminClient.from("event_waitlist").select("event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [] as { event_id: string }[], error: null }),
    (() => {
      const creatorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
      return creatorIds.length
        ? adminClient.from("profiles").select("id, display_name").in("id", creatorIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[], error: null });
    })(),
  ]);

  const regCounts: Record<string, number> = {};
  for (const r of regResult.data ?? []) regCounts[r.event_id] = (regCounts[r.event_id] ?? 0) + 1;

  const wlCounts: Record<string, number> = {};
  for (const r of wlResult.data ?? []) wlCounts[r.event_id] = (wlCounts[r.event_id] ?? 0) + 1;

  const profileMap: Record<string, string | null> = {};
  for (const p of profilesResult.data ?? []) profileMap[p.id] = p.display_name ?? null;

  const mapped: EventWithMeta[] = rows.map((row) => ({
    ...(row as unknown as Event),
    registration_count: regCounts[row.id] ?? 0,
    waitlist_count: wlCounts[row.id] ?? 0,
    creator_name: row.created_by ? (profileMap[row.created_by] ?? null) : null,
  }));

  return { success: true, data: mapped };
}

// ── Get single event (admin) ──────────────────────────────────────

export async function getEvent(
  id: string
): Promise<{ success: true; data: EventWithMeta } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("events")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Not found" };

  const [regResult, wlResult, profileResult] = await Promise.all([
    adminClient.from("event_registrations").select("id", { count: "exact", head: true }).eq("event_id", id).eq("status", "registered"),
    adminClient.from("event_waitlist").select("id", { count: "exact", head: true }).eq("event_id", id),
    data.created_by
      ? adminClient.from("profiles").select("display_name").eq("id", data.created_by).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    success: true,
    data: {
      ...(data as unknown as Event),
      registration_count: regResult.count ?? 0,
      waitlist_count: wlResult.count ?? 0,
      creator_name: (profileResult.data as any)?.display_name ?? null,
    } as EventWithMeta,
  };
}

// ── Create event (admin — starts as draft) ────────────────────────

export async function createEvent(
  payload: CreateEventPayload
): Promise<{ success: true; data: Event } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const slug = generateSlug(payload.title, payload.starts_at);

  const { data, error } = await adminClient
    .from("events")
    .insert({
      slug,
      title: payload.title,
      description: payload.description ?? null,
      body_html: payload.body_html ?? null,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at ?? null,
      location: payload.location ?? null,
      virtual_link: payload.virtual_link ?? null,
      is_virtual: payload.is_virtual ?? false,
      audience_mode: payload.audience_mode ?? "members_only",
      capacity: payload.capacity ?? null,
      status: "draft",
      created_by: auth.ctx.userId,
    })
    .select()
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };

  await Promise.all([
    logAuditEventSafe({
      actorId: auth.ctx.userId,
      action: "event.created",
      entityType: "event",
      entityId: data.id,
      details: { title: data.title, status: "draft" },
    }),
    registerCreatorAsHost(data.id, auth.ctx.userId),
  ]);

  return { success: true, data: data as Event };
}

// ── Create event (member — starts as pending_review) ─────────────

export async function createEventByMember(
  payload: CreateEventPayload
): Promise<{ success: true; data: Event } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Members, org_admins, partners, and global admins can create events
  const { globalRole } = auth.ctx;
  const eligibleRoles = ["member", "org_admin", "partner", "admin", "super_admin"];
  if (!eligibleRoles.includes(globalRole)) {
    return { success: false, error: "Not eligible to create events" };
  }

  const adminClient = createAdminClient();
  const slug = generateSlug(payload.title, payload.starts_at);

  // Admin-created events skip review; member/org_admin go to pending_review
  const status = isGlobalAdmin(globalRole) ? "draft" : "pending_review";

  const { data, error } = await adminClient
    .from("events")
    .insert({
      slug,
      title: payload.title,
      description: payload.description ?? null,
      body_html: payload.body_html ?? null,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at ?? null,
      location: payload.location ?? null,
      virtual_link: payload.virtual_link ?? null,
      is_virtual: payload.is_virtual ?? false,
      audience_mode: payload.audience_mode ?? "members_only",
      capacity: payload.capacity ?? null,
      status,
      created_by: auth.ctx.userId,
    })
    .select()
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };

  await Promise.all([
    logAuditEventSafe({
      actorId: auth.ctx.userId,
      action: "event.created",
      entityType: "event",
      entityId: data.id,
      details: { title: data.title, status },
    }),
    registerCreatorAsHost(data.id, auth.ctx.userId),
  ]);

  // Alert admins when a non-admin submits for review
  if (status === "pending_review") {
    void notifyAdminsEventSubmitted(data.id, data.title, data.starts_at, data.is_virtual, auth.ctx.userId).catch(
      (e) => console.error("[events] notifyAdminsEventSubmitted failed:", e)
    );
  }

  revalidatePath("/events", "page");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/admin/events", "page");

  return { success: true, data: data as Event };
}

// ── Update event ──────────────────────────────────────────────────

export async function updateEvent(
  id: string,
  payload: UpdateEventPayload
): Promise<{ success: true; data: Event } | { success: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Non-admins can only edit events they created
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    const { data: existing } = await adminClient
      .from("events")
      .select("created_by, status")
      .eq("id", id)
      .single();

    if (!existing) return { success: false, error: "Event not found" };
    if (existing.created_by !== auth.ctx.userId) {
      return { success: false, error: "Not authorized to edit this event" };
    }
    // Creators can only edit their own events that are not yet published
    if (existing.status === "published" || existing.status === "completed") {
      return { success: false, error: "Cannot edit a published or completed event" };
    }
  }

  const updates: Record<string, unknown> = { ...payload, updated_at: new Date().toISOString() };

  // Re-derive slug if title or starts_at changed (and slug not explicitly set)
  if ((payload.title || payload.starts_at) && !payload.slug) {
    const { data: current } = await adminClient
      .from("events")
      .select("title, starts_at")
      .eq("id", id)
      .single();
    if (current) {
      updates.slug = generateSlug(
        payload.title ?? current.title,
        payload.starts_at ?? current.starts_at ?? new Date().toISOString()
      );
    }
  }

  const { data, error } = await adminClient
    .from("events")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Update failed" };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.updated",
    entityType: "event",
    entityId: id,
    details: { fields: Object.keys(payload) },
  });

  revalidatePath("/events", "page");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/admin/events", "page");
  revalidatePath(`/admin/events/${id}`, "page");

  return { success: true, data: data as Event };
}

// ── Approve event (pending_review → published) ────────────────────

export async function approveEvent(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("events")
    .select("status, title, is_virtual, starts_at, ends_at, created_by")
    .eq("id", id)
    .single();

  if (!existing) return { success: false, error: "Event not found" };
  if (existing.status !== "pending_review") {
    return { success: false, error: `Cannot approve event with status: ${existing.status}` };
  }

  // Fetch creator email so they get added as a Calendar attendee
  let creatorEmail: string | undefined;
  if (existing.created_by) {
    const { data: authUser } = await adminClient.auth.admin.getUserById(existing.created_by);
    creatorEmail = authUser?.user?.email ?? undefined;
  }

  // Mint a Meet link for virtual events before publishing
  const meetUpdates: Record<string, string> = {};
  if (existing.is_virtual) {
    if (existing.starts_at) {
      const meetResult = await createCalendarEventWithMeet({
        eventId: id,
        title: existing.title,
        startsAt: existing.starts_at,
        endsAt: existing.ends_at,
        attendeeEmails: creatorEmail ? [creatorEmail] : undefined,
      });
      if (meetResult.ok) {
        meetUpdates.virtual_link = meetResult.meetLink;
        meetUpdates.google_event_id = meetResult.googleEventId;
        meetUpdates.google_meet_link = meetResult.meetLink;
      }
    }
    // Non-fatal: if Meet link creation fails, event still publishes
  }

  const { error } = await adminClient
    .from("events")
    .update({ status: "published", updated_at: new Date().toISOString(), ...meetUpdates })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.approved",
    entityType: "event",
    entityId: id,
    details: { title: existing.title, meet_link_created: Object.keys(meetUpdates).length > 0 },
  });

  revalidatePath("/events", "page");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/admin/events", "page");
  revalidatePath(`/admin/events/${id}`, "page");

  // Notify creator their event is live
  if (creatorEmail && existing.created_by) {
    void notifyCreatorEventApproved(
      id, existing.title, existing.starts_at, meetUpdates.google_meet_link, creatorEmail
    ).catch((e) => console.error("[events] notifyCreatorEventApproved failed:", e));
  }

  return { success: true };
}

// ── Transition status (admin) ─────────────────────────────────────

export async function transitionEventStatus(
  id: string,
  newStatus: EventStatus
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("events")
    .select("status, title, is_virtual, starts_at, ends_at, google_event_id, created_by")
    .eq("id", id)
    .single();

  if (!existing) return { success: false, error: "Event not found" };

  const allowed = TRANSITIONS[existing.status as EventStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition from ${existing.status} to ${newStatus}`,
    };
  }

  const extraUpdates: Record<string, string | null> = {};

  // Mint Meet link when a draft virtual event goes to published
  if (newStatus === "published" && existing.is_virtual && !existing.google_event_id && existing.starts_at) {
    let creatorEmail: string | undefined;
    if (existing.created_by) {
      const { data: authUser } = await adminClient.auth.admin.getUserById(existing.created_by);
      creatorEmail = authUser?.user?.email ?? undefined;
    }

    const meetResult = await createCalendarEventWithMeet({
      eventId: id,
      title: existing.title,
      startsAt: existing.starts_at,
      endsAt: existing.ends_at,
      attendeeEmails: creatorEmail ? [creatorEmail] : undefined,
    });
    if (meetResult.ok) {
      extraUpdates.virtual_link = meetResult.meetLink;
      extraUpdates.google_event_id = meetResult.googleEventId;
      extraUpdates.google_meet_link = meetResult.meetLink;
    }
    // Non-fatal: publish proceeds even if Meet link creation fails
  }

  // Remove Google Calendar event when cancelling
  if (newStatus === "cancelled" && existing.google_event_id) {
    const delResult = await deleteCalendarEvent(existing.google_event_id).catch((e) => {
      console.error("[events] deleteCalendarEvent threw:", e);
      return { ok: false as const, error: String(e) };
    });
    if (delResult.ok) {
      // Clear the stored IDs so we don't attempt a double-delete
      extraUpdates.google_event_id = null;
      extraUpdates.google_meet_link = null;
    } else {
      console.error("[events] deleteCalendarEvent failed:", delResult.error);
    }
  }

  // Resolve creator email for notifications (needed before the update)
  let creatorEmailForNotify: string | undefined;
  if (existing.created_by && (newStatus === "published" || newStatus === "cancelled")) {
    const { data: authUser } = await adminClient.auth.admin.getUserById(existing.created_by);
    creatorEmailForNotify = authUser?.user?.email ?? undefined;
  }

  const { error } = await adminClient
    .from("events")
    .update({ status: newStatus, updated_at: new Date().toISOString(), ...extraUpdates })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.status_changed",
    entityType: "event",
    entityId: id,
    details: { from: existing.status, to: newStatus },
  });

  revalidatePath("/events", "page");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/admin/events", "page");
  revalidatePath(`/admin/events/${id}`, "page");

  // Notify creator when their pending_review event gets published by an admin
  if (newStatus === "published" && existing.status === "pending_review" && creatorEmailForNotify) {
    void notifyCreatorEventApproved(
      id, existing.title, existing.starts_at, extraUpdates.google_meet_link ?? undefined, creatorEmailForNotify
    ).catch((e) => console.error("[events] notifyCreatorEventApproved failed:", e));
  }

  // Notify all registrants when an event is cancelled
  if (newStatus === "cancelled") {
    void (async () => {
      try {
        const eventDate = existing.starts_at
          ? parseUTC(existing.starts_at).toLocaleString("en-CA", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
              hour: "2-digit", minute: "2-digit", timeZoneName: "short",
            })
          : "";

        // Fetch all confirmed registrants
        const { data: regs } = await adminClient
          .from("event_registrations")
          .select("user_id")
          .eq("event_id", id)
          .in("status", ["registered", "promoted"]);

        if (!regs?.length) return;

        for (const reg of regs) {
          const { data: authUser } = await adminClient.auth.admin.getUserById(reg.user_id);
          const email = authUser?.user?.email;
          if (!email) continue;

          const { data: profile } = await adminClient
            .from("profiles")
            .select("display_name")
            .eq("id", reg.user_id)
            .single();

          await sendTransactional({
            templateKey: "event_cancelled",
            to: email,
            variables: {
              registrant_name: profile?.display_name ?? email,
              event_title: existing.title,
              event_date: eventDate,
            },
          });
        }
      } catch (e) {
        console.error("[events] event_cancelled notifications failed:", e);
      }
    })();
  }

  return { success: true };
}

// ── Request changes + notify creator ─────────────────────────────

export async function requestEventChanges(
  id: string,
  payload: UpdateEventPayload,
  adminNote?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("events")
    .select("title, starts_at, created_by, status")
    .eq("id", id)
    .single();

  if (!existing) return { success: false, error: "Event not found" };

  // Apply the edits
  const updates: Record<string, unknown> = {
    ...payload,
    status: "draft",
    updated_at: new Date().toISOString(),
  };

  if ((payload.title || payload.starts_at) && !payload.slug) {
    updates.slug = generateSlug(
      payload.title ?? existing.title,
      payload.starts_at ?? existing.starts_at ?? new Date().toISOString()
    );
  }

  const { error: updateErr } = await adminClient
    .from("events")
    .update(updates)
    .eq("id", id);

  if (updateErr) return { success: false, error: updateErr.message };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.changes_requested",
    entityType: "event",
    entityId: id,
    details: { title: existing.title, note: adminNote ?? null },
  });

  // Notify the creator
  if (existing.created_by) {
    void (async () => {
      const [profileRes, authRes] = await Promise.all([
        adminClient.from("profiles").select("display_name").eq("id", existing.created_by!).single(),
        adminClient.auth.admin.getUserById(existing.created_by!),
      ]);

      const creatorEmail = authRes.data?.user?.email;
      if (!creatorEmail) return;

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const adminNoteBlock = adminNote
        ? `<p style="margin:12px 0 0;font-size:13px;color:#374151;"><strong>Note from admin:</strong> ${adminNote}</p>`
        : "";

      await sendTransactional({
        templateKey: "event_changes_requested",
        to: creatorEmail,
        variables: {
          creator_name: profileRes.data?.display_name ?? "there",
          event_title: payload.title ?? existing.title,
          event_date: formatEventDate(payload.starts_at ?? existing.starts_at),
          event_edit_url: `${appUrl}/me/events`,
          admin_note_block: adminNoteBlock,
        },
      });
    })().catch((e) => console.error("[events] requestEventChanges notify failed:", e));
  }

  return { success: true };
}

// ── Delete event (admin, draft/pending_review only) ───────────────

export async function deleteEvent(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("events")
    .select("status, title")
    .eq("id", id)
    .single();

  if (!existing) return { success: false, error: "Event not found" };
  if (!["draft", "pending_review"].includes(existing.status)) {
    return { success: false, error: "Only draft or pending_review events can be deleted" };
  }

  const { error } = await adminClient.from("events").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    actorId: auth.ctx.userId,
    action: "event.deleted",
    entityType: "event",
    entityId: id,
    details: { title: existing.title },
  });

  return { success: true };
}

// ── Email notification helpers ────────────────────────────────────

function formatEventDate(startsAt: string | null): string {
  if (!startsAt) return "";
  return parseUTC(startsAt).toLocaleString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

/**
 * Send admin alert when a member submits an event for review.
 * Runs async/non-blocking — never throws into the calling action.
 */
async function notifyAdminsEventSubmitted(
  eventId: string,
  eventTitle: string,
  startsAt: string | null,
  isVirtual: boolean,
  createdBy: string
): Promise<void> {
  const supabase = createAdminClient();

  // Resolve creator display name + email
  const [profileRes, authRes] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", createdBy).single(),
    supabase.auth.admin.getUserById(createdBy),
  ]);
  const creatorName = profileRes.data?.display_name ?? "A member";
  const creatorEmail = authRes.data?.user?.email ?? "";

  const { approveUrl, changesUrl } = buildEventActionUrls(eventId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  await triggerAutomation({
    triggerSource: "events",
    triggerEventKey: `event_submitted:${eventId}`,
    templateKey: "event_submitted",
    automationMode: "auto_send",
    campaignName: `Event Review: ${eventTitle}`,
    audience: { type: "global_admins" },
    variableValues: {
      event_title: eventTitle,
      creator_name: creatorName,
      creator_email: creatorEmail,
      event_date: formatEventDate(startsAt),
      event_type: isVirtual ? "Virtual (Google Meet)" : "In-Person",
      approve_url: approveUrl,
      changes_url: changesUrl,
      admin_url: `${appUrl}/admin/events`,
    },
  });
}

/**
 * Send creator notification when their event is approved and live.
 * Runs async/non-blocking — never throws into the calling action.
 */
async function notifyCreatorEventApproved(
  eventId: string,
  eventTitle: string,
  startsAt: string | null,
  meetLink: string | undefined,
  creatorEmail: string
): Promise<void> {
  const supabase = createAdminClient();
  const profileRes = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", (await supabase.auth.admin.listUsers()).data.users.find((u) => u.email === creatorEmail)?.id ?? "")
    .maybeSingle();

  const creatorName = profileRes.data?.display_name ?? "there";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const meetLinkBlock = meetLink
    ? `<p style="margin:12px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${meetLink}" style="color:#6366f1;">${meetLink}</a></p>`
    : "";

  await sendTransactional({
    templateKey: "event_approved",
    to: creatorEmail,
    variables: {
      creator_name: creatorName,
      event_title: eventTitle,
      event_date: formatEventDate(startsAt),
      event_url: `${appUrl}/events/${eventId}`,
      meet_link_block: meetLinkBlock,
    },
  });
}

// ── Public attendee list ──────────────────────────────────────────

/**
 * Returns the attendee list for a published event.
 * - Any caller: gets display names (no emails) + total count.
 * - Capped at 50 names for display.
 */
export async function getPublicAttendees(
  eventId: string
): Promise<{ success: true; data: { total: number; names: (string | null)[] } } | { success: false; error: string }> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("event_registrations")
    .select("user_id")
    .eq("event_id", eventId)
    .in("status", ["registered", "promoted"])
    .order("registered_at", { ascending: true })
    .limit(50);

  if (error) return { success: false, error: error.message };

  const userIds = (data ?? []).map((r: any) => r.user_id);
  const { data: profileRows } = userIds.length > 0
    ? await adminClient.from("profiles").select("id, display_name").in("id", userIds)
    : { data: [] };
  const nameMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.display_name ?? null]));
  const names = userIds.map((uid) => nameMap.get(uid) ?? null);

  // Total count (may exceed 50)
  const { count } = await adminClient
    .from("event_registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .in("status", ["registered", "promoted"]);

  return { success: true, data: { total: count ?? names.length, names } };
}

// ── Public list (no auth) ─────────────────────────────────────────

export async function listPublishedEvents(): Promise<
  { success: true; data: Event[] } | { success: false; error: string }
> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("events")
    .select("*")
    .eq("status", "published")
    .order("starts_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as Event[] };
}

// ── Public detail by slug ─────────────────────────────────────────

export async function getEventBySlug(
  slug: string,
  userId?: string
): Promise<{ success: true; data: Event & { spots_remaining: number | null; user_registration_status: "registered" | "waitlisted" | "cancelled" | null } } | { success: false; error: string }> {
  const adminClient = createAdminClient();

  const { data: event, error } = await adminClient
    .from("events")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !event) return { success: false, error: "Event not found" };

  // Count registrations to compute spots remaining
  let spots_remaining: number | null = null;
  if (event.capacity !== null) {
    const { count } = await adminClient
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("status", "registered");
    spots_remaining = Math.max(0, event.capacity - (count ?? 0));
  }

  // Check user's registration state
  let user_registration_status: "registered" | "waitlisted" | "cancelled" | null = null;
  if (userId) {
    const { data: reg } = await adminClient
      .from("event_registrations")
      .select("status")
      .eq("event_id", event.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (reg) {
      user_registration_status = reg.status as "registered" | "waitlisted" | "cancelled";
    } else {
      const { data: wl } = await adminClient
        .from("event_waitlist")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (wl) user_registration_status = "waitlisted";
    }
  }

  return {
    success: true,
    data: { ...(event as Event), spots_remaining, user_registration_status },
  };
}

// ── Member: list my created events ───────────────────────────────

export async function listMyCreatedEvents(): Promise<
  { success: true; data: Event[] } | { success: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("events")
    .select("*")
    .eq("created_by", auth.ctx.userId)
    .order("starts_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as Event[] };
}

// ── CSC defaults for admin-created events ─────────────────────────

const CSC_ORG_CONTEXT = {
  creator_display_name: null as string | null,
  creator_org_name: "Campus Stores Canada",
  creator_primary_color: "#163D6D",
  creator_lat: 56,
  creator_lng: -95,
  creator_zoom: 3,
};

// ── Published events with org branding context ────────────────────

export async function listPublishedEventsWithOrgContext(
  userId?: string
): Promise<{ success: true; data: EventWithOrgContext[] } | { success: false; error: string }> {
  const adminClient = createAdminClient();

  // 1. Fetch all published events
  const { data: events, error: eventsErr } = await adminClient
    .from("events")
    .select("*")
    .eq("status", "published")
    .order("starts_at", { ascending: true });

  if (eventsErr || !events) {
    return { success: false, error: eventsErr?.message ?? "Failed to load events" };
  }

  if (events.length === 0) return { success: true, data: [] };

  // 2. Collect unique creator IDs
  const creatorIds = [...new Set(events.map((e) => e.created_by).filter(Boolean))] as string[];

  // 3. Build org context map: userId → { org name, color, lat, lng, zoom }
  const orgContextByUser = new Map<string, Omit<typeof CSC_ORG_CONTEXT, never>>();

  if (creatorIds.length > 0) {
    // Fetch creator display names + memberships in parallel
    const [membershipsResult, profilesResult] = await Promise.all([
      adminClient
        .from("user_organizations")
        .select("user_id, organization_id")
        .in("user_id", creatorIds)
        .order("created_at", { ascending: true }),
      adminClient
        .from("profiles")
        .select("id, display_name")
        .in("id", creatorIds),
    ]);

    // Display name by user id
    const displayNameByUser = new Map<string, string | null>();
    for (const p of profilesResult.data ?? []) {
      displayNameByUser.set(p.id, p.display_name ?? null);
    }

    if (membershipsResult.data && membershipsResult.data.length > 0) {
      // First org per user
      const userPrimaryOrg = new Map<string, string>();
      for (const m of membershipsResult.data) {
        if (!userPrimaryOrg.has(m.user_id)) {
          userPrimaryOrg.set(m.user_id, m.organization_id);
        }
      }

      const orgIds = [...new Set(userPrimaryOrg.values())];

      // Fetch org data + brand colors in parallel
      const [orgsResult, colorsResult] = await Promise.all([
        adminClient
          .from("organizations")
          .select("id, name, latitude, longitude")
          .in("id", orgIds),
        adminClient
          .from("brand_colors")
          .select("organization_id, hex, sort_order")
          .in("organization_id", orgIds)
          .order("sort_order", { ascending: true }),
      ]);

      // Primary color per org (first by sort_order)
      const orgPrimaryColor = new Map<string, string>();
      for (const c of colorsResult.data ?? []) {
        if (!orgPrimaryColor.has(c.organization_id) && c.hex) {
          const hex = c.hex.startsWith("#") ? c.hex : `#${c.hex}`;
          orgPrimaryColor.set(c.organization_id, hex);
        }
      }

      const orgById = new Map((orgsResult.data ?? []).map((o) => [o.id, o]));

      for (const [uid, orgId] of userPrimaryOrg.entries()) {
        const org = orgById.get(orgId);
        if (!org) continue;
        orgContextByUser.set(uid, {
          creator_display_name: displayNameByUser.get(uid) ?? null,
          creator_org_name: org.name ?? "Campus Stores Canada",
          creator_primary_color: orgPrimaryColor.get(orgId) ?? "#163D6D",
          creator_lat: Number(org.latitude ?? 56),
          creator_lng: Number(org.longitude ?? -95),
          creator_zoom: org.latitude != null ? 8 : 3,
        });
      }
    }
  }

  // 4. Batch registration status for current user
  const userRegMap = new Map<string, "registered" | "waitlisted" | "cancelled">();
  if (userId) {
    const { data: regs } = await adminClient
      .from("event_registrations")
      .select("event_id, status")
      .eq("user_id", userId)
      .in("event_id", events.map((e) => e.id));
    for (const r of regs ?? []) {
      userRegMap.set(r.event_id, r.status as "registered" | "waitlisted" | "cancelled");
    }
  }

  // 5. Batch registration counts for capacity events
  const capacityEventIds = events.filter((e) => e.capacity !== null).map((e) => e.id);
  const regCountMap = new Map<string, number>();
  if (capacityEventIds.length > 0) {
    const { data: regs } = await adminClient
      .from("event_registrations")
      .select("event_id")
      .in("event_id", capacityEventIds)
      .eq("status", "registered");
    for (const r of regs ?? []) {
      regCountMap.set(r.event_id, (regCountMap.get(r.event_id) ?? 0) + 1);
    }
  }

  // 6. Assemble enriched events
  const enriched: EventWithOrgContext[] = events.map((event) => {
    const orgCtx = (event.created_by ? orgContextByUser.get(event.created_by) : null) ?? CSC_ORG_CONTEXT;
    const spots_remaining =
      event.capacity === null
        ? null
        : Math.max(0, event.capacity - (regCountMap.get(event.id) ?? 0));
    return {
      ...(event as Event),
      spots_remaining,
      user_registration_status: userRegMap.get(event.id) ?? null,
      ...orgCtx,
    };
  });

  return { success: true, data: enriched };
}

// ── Single event with org branding context (for detail page) ──────

export async function getEventBySlugWithOrgContext(
  slug: string,
  userId?: string
): Promise<
  | { success: true; data: EventWithOrgContext & { spots_remaining: number | null; user_registration_status: "registered" | "waitlisted" | "cancelled" | null } }
  | { success: false; error: string }
> {
  const adminClient = createAdminClient();

  const { data: event, error } = await adminClient
    .from("events")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !event) return { success: false, error: "Event not found" };

  // Spots remaining
  let spots_remaining: number | null = null;
  if (event.capacity !== null) {
    const { count } = await adminClient
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("status", "registered");
    spots_remaining = Math.max(0, event.capacity - (count ?? 0));
  }

  // User registration status
  let user_registration_status: "registered" | "waitlisted" | "cancelled" | null = null;
  if (userId) {
    const { data: reg } = await adminClient
      .from("event_registrations")
      .select("status")
      .eq("event_id", event.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (reg) {
      user_registration_status = reg.status as "registered" | "waitlisted" | "cancelled";
    } else {
      const { data: wl } = await adminClient
        .from("event_waitlist")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (wl) user_registration_status = "waitlisted";
    }
  }

  // Org context + display name for creator
  let orgCtx = { ...CSC_ORG_CONTEXT };
  if (event.created_by) {
    const [membershipResult, profileResult] = await Promise.all([
      adminClient
        .from("user_organizations")
        .select("organization_id")
        .eq("user_id", event.created_by)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("display_name")
        .eq("id", event.created_by)
        .single(),
    ]);

    orgCtx.creator_display_name = profileResult.data?.display_name ?? null;

    if (membershipResult.data?.organization_id) {
      const orgId = membershipResult.data.organization_id;
      const [orgResult, colorResult] = await Promise.all([
        adminClient
          .from("organizations")
          .select("id, name, latitude, longitude")
          .eq("id", orgId)
          .single(),
        adminClient
          .from("brand_colors")
          .select("hex, sort_order")
          .eq("organization_id", orgId)
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      const org = orgResult.data;
      if (org) {
        const rawHex = colorResult.data?.hex ?? "#163D6D";
        const hex = rawHex.startsWith("#") ? rawHex : `#${rawHex}`;
        orgCtx = {
          ...orgCtx,
          creator_org_name: org.name ?? "Campus Stores Canada",
          creator_primary_color: hex,
          creator_lat: Number(org.latitude ?? 56),
          creator_lng: Number(org.longitude ?? -95),
          creator_zoom: org.latitude != null ? 8 : 3,
        };
      }
    }
  }

  return {
    success: true,
    data: {
      ...(event as Event),
      spots_remaining,
      user_registration_status,
      ...orgCtx,
    },
  };
}
