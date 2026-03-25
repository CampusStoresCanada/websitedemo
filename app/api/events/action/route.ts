// ─────────────────────────────────────────────────────────────────
// GET /api/events/action?token=...
//
// Handles one-click email actions for event review:
//   approve  → publishes the event, redirects to admin events list
//   changes  → redirects admin to the event edit page (still needs auth)
//
// The signed token IS the authorization for approve.
// Changes redirect requires the admin to be logged in to /admin.
// ─────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { verifyEventActionToken } from "@/lib/email/eventActionTokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCalendarEventWithMeet } from "@/lib/google/calendar";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { sendTransactional } from "@/lib/comms/send";
import { parseUTC } from "@/lib/utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

function redirect(path: string) {
  return NextResponse.redirect(`${APP_URL}${path}`);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return redirect("/admin/events?action_error=missing_token");

  const payload = verifyEventActionToken(token);
  if (!payload) return redirect("/admin/events?action_error=invalid_token");

  const { eventId, action } = payload;

  const supabase = createAdminClient();

  if (action === "changes") {
    // Transition pending_review → draft so the event is parked while admin edits
    const { data: ev } = await supabase
      .from("events")
      .select("status")
      .eq("id", eventId)
      .single();

    if (ev?.status === "pending_review") {
      await supabase
        .from("events")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", eventId);
    }

    // Redirect admin to edit page — they still need to be logged in there
    return redirect(`/admin/events/${eventId}/edit?from_review=1`);
  }

  // ── approve ───────────────────────────────────────────────────

  const { data: existing, error: fetchErr } = await supabase
    .from("events")
    .select("status, title, is_virtual, starts_at, ends_at, created_by, google_event_id")
    .eq("id", eventId)
    .single();

  if (fetchErr || !existing) {
    return redirect("/admin/events?action_error=event_not_found");
  }

  if (existing.status !== "pending_review") {
    // Already actioned — not an error, just redirect with a note
    return redirect(`/admin/events?action_notice=already_actioned`);
  }

  // Mint Meet link for virtual events
  const meetUpdates: Record<string, string> = {};
  let creatorEmail: string | undefined;

  if (existing.created_by) {
    const { data: authUser } = await supabase.auth.admin.getUserById(existing.created_by);
    creatorEmail = authUser?.user?.email ?? undefined;
  }

  if (existing.is_virtual && !existing.google_event_id && existing.starts_at) {
    const meetResult = await createCalendarEventWithMeet({
      eventId,
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

  const { error: updateErr } = await supabase
    .from("events")
    .update({
      status: "published",
      updated_at: new Date().toISOString(),
      ...meetUpdates,
    })
    .eq("id", eventId);

  if (updateErr) {
    console.error("[events/action] approve update failed:", updateErr);
    return redirect("/admin/events?action_error=approve_failed");
  }

  await logAuditEventSafe({
    actorId: null,
    action: "event.approved",
    entityType: "event",
    entityId: eventId,
    details: { title: existing.title, via: "email_action_link", meet_link_created: Object.keys(meetUpdates).length > 0 },
  });

  // Notify the creator their event was approved
  if (creatorEmail && existing.created_by) {
    const eventUrl = `${APP_URL}/events/${eventId}`;
    const startsAt = existing.starts_at
      ? parseUTC(existing.starts_at).toLocaleString("en-CA", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit", timeZoneName: "short",
        })
      : "";
    const meetLinkBlock = meetUpdates.google_meet_link
      ? `<p style="margin:12px 0 0;font-size:13px;color:#374151;">🎥 <strong>Google Meet:</strong> <a href="${meetUpdates.google_meet_link}" style="color:#6366f1;">${meetUpdates.google_meet_link}</a></p>`
      : "";

    await sendTransactional({
      templateKey: "event_approved",
      to: creatorEmail,
      variables: {
        creator_name: null, // profile name not fetched here — template handles empty gracefully
        event_title: existing.title,
        event_date: startsAt,
        event_url: eventUrl,
        meet_link_block: meetLinkBlock,
      },
    });
  }

  return redirect(`/admin/events?action_success=approved&event=${eventId}`);
}
