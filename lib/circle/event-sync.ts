// ---------------------------------------------------------------------------
// Circle ↔ Website event sync
//
// Two directions:
//   Push (website → Circle): when a CSC event is published/updated/cancelled
//   Pull (Circle → website): cron fetches Circle events + reconciles RSVPs
//
// Metadata convention on the `events` table (JSONB `metadata` column):
//   circle_event_id   number  — Circle event ID; set after first push
//   circle_origin     boolean — true = this event was pulled FROM Circle
//   circle_url        string  — deep link into Circle for RSVP button
//   tags              string[] — relevance tags for "For you" matching
//   categories        string[] — buying category tags
//   provinces         string[] — province relevance tags
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";
import { getCircleConfig } from "@/lib/circle/config";
import type { CircleEvent } from "@/lib/circle/types";
import { parseSupabaseTimestamp, isValidDate } from "@/lib/time/supabase-timestamp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEventsSpaceId(): number | null {
  const config = getCircleConfig();
  const raw = config?.eventsSpaceId;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

/** Convert a website event row into a Circle event payload. */
function buildCirclePayload(event: {
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  is_virtual: boolean;
  virtual_link: string | null;
}, spaceId: number) {
  // Supabase returns timestamps without Z — normalise to ISO 8601 UTC
  const normalise = (s: string | null) =>
    s
      ? s.endsWith("Z") || s.includes("+")
        ? s
        : s.replace(" ", "T") + "Z"
      : undefined;

  return {
    name: event.title,
    body: event.description ?? undefined,
    starts_at: normalise(event.starts_at)!,
    ends_at: normalise(event.ends_at),
    location_type: (event.is_virtual ? "virtual" : "in_person") as "virtual" | "in_person",
    in_person_location: !event.is_virtual ? (event.location ?? undefined) : undefined,
    virtual_location_url: event.is_virtual ? (event.virtual_link ?? undefined) : undefined,
    space_id: spaceId,
  };
}

/**
 * Convert Circle's plain-text event body into:
 *   description — first paragraph, capped at 280 chars (for listings)
 *   body_html   — full body as simple HTML paragraphs
 */
function circleBodyToContent(body: string | null): { description: string | null; body_html: string | null } {
  if (!body?.trim()) return { description: null, body_html: null };

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const firstPara = paragraphs[0] ?? "";
  const description = firstPara.length > 280
    ? firstPara.slice(0, 277) + "…"
    : firstPara;

  const body_html = paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return { description, body_html };
}

/**
 * How long an event stays in the hourly RSVP reconciliation loop.
 *
 * Without this, every event ever pushed to or pulled from Circle kept its slot
 * in the loop forever — `status` stays 'published' after an event ends, so the
 * cron re-fetched the attendee list of finished events once an hour, for good.
 * At 42 events that was ~1,000 Circle calls a day, all of them asking about
 * RSVPs that could no longer change, and the number only ever grew.
 */
const RSVP_SYNC_LEAD_MS = 60 * 24 * 60 * 60 * 1000; // start syncing 60 days out
const RSVP_SYNC_TRAIL_MS = 1 * 24 * 60 * 60 * 1000; // stop 1 day after it ends

/**
 * True while an event's Circle RSVPs are still worth re-reading.
 *
 * Fails open: an event missing both timestamps keeps syncing, since we cannot
 * prove it is over. A missing `ends_at` falls back to `starts_at` rather than
 * dropping the event out of the window silently.
 */
export function isInRsvpSyncWindow(
  event: { starts_at: string | null; ends_at: string | null },
  now: number
): boolean {
  const parse = (v: string | null): number | null => {
    if (!v) return null;
    const d = parseSupabaseTimestamp(v);
    return isValidDate(d) ? d.getTime() : null;
  };

  const startsAt = parse(event.starts_at);
  const endsAt = parse(event.ends_at) ?? startsAt;

  if (endsAt !== null && endsAt < now - RSVP_SYNC_TRAIL_MS) return false;
  if (startsAt !== null && startsAt > now + RSVP_SYNC_LEAD_MS) return false;
  return true;
}

/** Read circle_event_id from event metadata safely. */
function getCircleEventId(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const v = m["circle_event_id"];
  return typeof v === "number" ? v : null;
}

// ---------------------------------------------------------------------------
// Push: website → Circle
// ---------------------------------------------------------------------------

/**
 * Push a newly published website event to Circle.
 * Stores the resulting circle_event_id back into events.metadata.
 * Safe to call multiple times — skips if already pushed.
 */
export async function pushEventToCircle(eventId: string): Promise<{
  ok: boolean;
  circleEventId?: number;
  skipped?: boolean;
  error?: string;
}> {
  const circle = getCircleClient();
  const spaceId = getEventsSpaceId();
  if (!circle || !spaceId) return { ok: true, skipped: true };

  const db = createAdminClient();
  const { data: event } = await db
    .from("events")
    .select("id, title, description, starts_at, ends_at, location, is_virtual, virtual_link, metadata")
    .eq("id", eventId)
    .single();

  if (!event) return { ok: false, error: "Event not found" };

  // Already pushed
  const existingId = getCircleEventId(event.metadata);
  if (existingId) return { ok: true, skipped: true, circleEventId: existingId };

  try {
    const payload = buildCirclePayload(event, spaceId);
    const circleEvent = await circle.createEvent(payload);

    // Store circle_event_id in metadata
    const current = (typeof event.metadata === "object" && event.metadata) ? event.metadata as Record<string, unknown> : {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from("events").update({ metadata: { ...current, circle_event_id: circleEvent.id, circle_url: circleEvent.url, circle_origin: false } as any }).eq("id", eventId);

    console.log(`[circle/event-sync] Pushed event ${eventId} → Circle #${circleEvent.id}`);
    return { ok: true, circleEventId: circleEvent.id };
  } catch (err) {
    console.error("[circle/event-sync] pushEventToCircle failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sync an updated website event back to Circle (if it was previously pushed).
 */
export async function updateEventInCircle(eventId: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
}> {
  const circle = getCircleClient();
  if (!circle) return { ok: true, skipped: true };

  const db = createAdminClient();
  const { data: event } = await db
    .from("events")
    .select("title, description, starts_at, ends_at, location, is_virtual, virtual_link, metadata")
    .eq("id", eventId)
    .single();

  if (!event) return { ok: false, error: "Event not found" };

  const circleEventId = getCircleEventId(event.metadata);
  if (!circleEventId) return { ok: true, skipped: true }; // never pushed

  const spaceId = getEventsSpaceId();
  if (!spaceId) return { ok: true, skipped: true };

  try {
    await circle.updateEvent(circleEventId, buildCirclePayload(event, spaceId));
    return { ok: true };
  } catch (err) {
    console.error("[circle/event-sync] updateEventInCircle failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Remove a cancelled/deleted website event from Circle.
 */
export async function removeEventFromCircle(eventId: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
}> {
  const circle = getCircleClient();
  if (!circle) return { ok: true, skipped: true };

  const db = createAdminClient();
  const { data: event } = await db
    .from("events")
    .select("metadata")
    .eq("id", eventId)
    .single();

  if (!event) return { ok: false, error: "Event not found" };

  const circleEventId = getCircleEventId(event.metadata);
  if (!circleEventId) return { ok: true, skipped: true };

  try {
    await circle.destroyEvent(circleEventId);

    // Clear circle_event_id from metadata so a re-publish would re-create
    const current = (typeof event.metadata === "object" && event.metadata) ? event.metadata as Record<string, unknown> : {};
    const { circle_event_id: _, circle_url: __, ...rest } = current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from("events").update({ metadata: rest as any }).eq("id", eventId);

    return { ok: true };
  } catch (err) {
    console.error("[circle/event-sync] removeEventFromCircle failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Pull: Circle → website
// ---------------------------------------------------------------------------

/**
 * Pull all Circle events and upsert Circle-native ones into the website events table.
 * Events that were pushed FROM the website (have circle_event_id in metadata) are skipped
 * — we already have the source of truth.
 */
export async function pullCircleEvents(): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}> {
  const circle = getCircleClient();
  const spaceId = getEventsSpaceId();
  if (!circle || !spaceId) return { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  const stats = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const db = createAdminClient();

  // Fetch all Circle events (paginated)
  let circleEvents: CircleEvent[];
  try {
    circleEvents = await circle.listAllEvents(spaceId);
  } catch (err) {
    console.error("[circle/event-sync] listAllEvents failed:", err);
    stats.errors++;
    return stats;
  }

  if (circleEvents.length === 0) return stats;

  // Build a set of circle_event_ids we already have in the DB
  const { data: existing } = await db
    .from("events")
    .select("id, metadata");

  const circleIdToWebsiteId = new Map<number, string>();
  const circleIdToExistingMeta = new Map<number, Record<string, unknown>>();
  const websitePushedIds = new Set<number>(); // events pushed FROM website

  for (const row of existing ?? []) {
    const cid = getCircleEventId(row.metadata);
    if (cid) {
      circleIdToWebsiteId.set(cid, row.id);
      const meta = row.metadata as Record<string, unknown> | null;
      if (meta) circleIdToExistingMeta.set(cid, meta);
      if (!meta?.["circle_origin"]) websitePushedIds.add(cid);
    }
  }

  const normalise = (s: string | null | undefined) =>
    s
      ? s.endsWith("Z") || s.includes("+")
        ? s
        : s.replace(" ", "T") + "Z"
      : null;

  for (const ce of circleEvents) {
    try {
      // Skip events that originated on the website
      if (websitePushedIds.has(ce.id)) {
        stats.skipped++;
        continue;
      }

      const circleCoreMeta = {
        circle_event_id: ce.id,
        circle_origin: true,
        circle_url: ce.url,
      };

      if (circleIdToWebsiteId.has(ce.id)) {
        // Update existing Circle-native event — merge metadata so admin-set
        // tags and other custom fields are preserved.
        const existingMeta = circleIdToExistingMeta.get(ce.id) ?? {};
        const { description, body_html } = circleBodyToContent(ce.body);
        await db
          .from("events")
          .update({
            title: ce.name,
            description,
            body_html,
            starts_at: normalise(ce.starts_at),
            ends_at: normalise(ce.ends_at),
            location: ce.in_person_location ?? null,
            is_virtual: ce.location_type === "virtual",
            virtual_link: ce.virtual_location_url ?? null,
            updated_at: new Date().toISOString(),
            metadata: { ...existingMeta, ...circleCoreMeta },
          })
          .eq("id", circleIdToWebsiteId.get(ce.id)!);
        stats.updated++;
      } else {
        // Insert new Circle-native event — default to "all-members" tag so it
        // surfaces in members' "For you" feed. Admins can refine per-event.
        const { description, body_html } = circleBodyToContent(ce.body);
        const slug = `circle-${ce.id}-${ce.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 40)}`;
        await db.from("events").insert({
          title: ce.name,
          description,
          body_html,
          starts_at: normalise(ce.starts_at),
          ends_at: normalise(ce.ends_at),
          location: ce.in_person_location ?? null,
          is_virtual: ce.location_type === "virtual",
          virtual_link: ce.virtual_location_url ?? null,
          audience_mode: "public", // Circle-native events are public by default
          status: "published",
          metadata: { ...circleCoreMeta, tags: ["all-members"] },
          slug,
        });
        stats.inserted++;
      }
    } catch (err) {
      console.error(`[circle/event-sync] Failed to sync Circle event #${ce.id}:`, err);
      stats.errors++;
    }
  }

  console.log("[circle/event-sync] pullCircleEvents:", stats);
  return stats;
}

// ---------------------------------------------------------------------------
// RSVP sync
// ---------------------------------------------------------------------------

/**
 * Pull Circle attendees for a single event and reconcile against event_registrations.
 *
 * For website-pushed events: creates event_registration rows for anyone who
 * RSVPd in Circle but doesn't have a website registration.
 *
 * For Circle-native events: just caches the attendee list for display.
 */
export async function syncEventRsvps(
  websiteEventId: string,
  circleEventId: number
): Promise<{ synced: number; created: number; errors: number }> {
  const circle = getCircleClient();
  if (!circle) return { synced: 0, created: 0, errors: 0 };

  const db = createAdminClient();
  const stats = { synced: 0, created: 0, errors: 0 };

  let attendees;
  try {
    attendees = await circle.listAllEventAttendees(circleEventId);
  } catch (err) {
    console.error(`[circle/event-sync] listAllEventAttendees(${circleEventId}) failed:`, err);
    stats.errors++;
    return stats;
  }

  if (attendees.length === 0) return stats;

  // Resolve Circle member IDs → supabase user IDs via circle_member_mapping
  const circleMemberIds = attendees.map((a) => a.community_member_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mappings } = await (db.from("circle_member_mapping") as any)
    .select("circle_member_id, supabase_user_id")
    .in("circle_member_id", circleMemberIds) as {
      data: Array<{ circle_member_id: number; supabase_user_id: string | null }> | null;
    };

  const userIdByCircleMemberId = new Map<number, string>();
  for (const m of mappings ?? []) {
    if (m.supabase_user_id) {
      userIdByCircleMemberId.set(m.circle_member_id, m.supabase_user_id);
    }
  }

  // Email fallback: for attendees not yet linked in the mapping table,
  // batch-resolve their Circle emails via a SECURITY DEFINER RPC that
  // can read auth.users, then write-through to the mapping table.
  const unmatchedAttendees = attendees.filter(
    (a) => !userIdByCircleMemberId.has(a.community_member_id) && a.member_email
  );

  if (unmatchedAttendees.length > 0) {
    const emails = unmatchedAttendees.map((a) => a.member_email!.toLowerCase());

    const { data: resolvedUsers } = await db.rpc("get_users_by_emails", { p_emails: emails }) as {
      data: Array<{ id: string; email: string }> | null;
    };

    if (resolvedUsers && resolvedUsers.length > 0) {
      const userIdByEmail = new Map(resolvedUsers.map((u) => [u.email.toLowerCase(), u.id]));

      for (const attendee of unmatchedAttendees) {
        const supabaseUserId = userIdByEmail.get(attendee.member_email!.toLowerCase());
        if (!supabaseUserId) continue;

        userIdByCircleMemberId.set(attendee.community_member_id, supabaseUserId);

        // Write-through: fill supabase_user_id on the existing mapping row
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db.from("circle_member_mapping") as any)
          .update({
            supabase_user_id: supabaseUserId,
            match_method: "email",
            updated_at: new Date().toISOString(),
          })
          .eq("circle_member_id", attendee.community_member_id)
          .is("supabase_user_id", null);
      }
    }
  }

  // Existing registrations for this event (to avoid duplicates)
  const { data: existingRegs } = await db
    .from("event_registrations")
    .select("user_id")
    .eq("event_id", websiteEventId)
    .in("status", ["registered", "promoted"]);

  const registeredUserIds = new Set((existingRegs ?? []).map((r) => r.user_id));

  // Existing RSVP cache entries (table added via migration; cast until types regenerated)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingCache } = await (db as any)
    .from("circle_event_rsvp_cache")
    .select("circle_member_id")
    .eq("circle_event_id", circleEventId) as {
      data: Array<{ circle_member_id: number }> | null;
    };

  const cachedMemberIds = new Set((existingCache ?? []).map((r) => r.circle_member_id));

  for (const attendee of attendees) {
    try {
      const supabaseUserId = userIdByCircleMemberId.get(attendee.community_member_id) ?? null;

      // Upsert into cache
      if (!cachedMemberIds.has(attendee.community_member_id)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from("circle_event_rsvp_cache").insert({
          event_id: websiteEventId,
          circle_event_id: circleEventId,
          circle_member_id: attendee.community_member_id,
          circle_attendee_id: attendee.id,
          supabase_user_id: supabaseUserId,
          rsvp_status: attendee.rsvp_status,
          reconciled: supabaseUserId ? registeredUserIds.has(supabaseUserId) : false,
          synced_at: new Date().toISOString(),
        });
        cachedMemberIds.add(attendee.community_member_id);
      }

      stats.synced++;

      // If we have a website user who isn't registered yet → create registration
      if (
        supabaseUserId &&
        !registeredUserIds.has(supabaseUserId) &&
        attendee.rsvp_status === "yes"
      ) {
        await db.from("event_registrations").insert({
          event_id: websiteEventId,
          user_id: supabaseUserId,
          status: "registered",
          payment_status: "free",
          amount_paid_cents: 0,
          registered_at: new Date().toISOString(),
        });
        registeredUserIds.add(supabaseUserId);

        // Mark as reconciled in cache
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from("circle_event_rsvp_cache")
          .update({ reconciled: true })
          .eq("circle_event_id", circleEventId)
          .eq("circle_member_id", attendee.community_member_id);

        stats.created++;
      }
    } catch (err) {
      console.error(
        `[circle/event-sync] Failed to sync attendee ${attendee.community_member_id}:`,
        err
      );
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Push a website RSVP to Circle (best-effort, non-blocking).
 * Call this after a successful event_registration insert.
 */
export async function pushRsvpToCircle(
  userId: string,
  eventId: string
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const circle = getCircleClient();
  if (!circle) return { ok: true, skipped: true };

  const db = createAdminClient();

  // Get the event's circle_event_id
  const { data: event } = await db
    .from("events")
    .select("metadata")
    .eq("id", eventId)
    .single();

  const circleEventId = getCircleEventId(event?.metadata ?? null);
  if (!circleEventId) return { ok: true, skipped: true }; // not synced to Circle

  // Get the user's Circle member ID
  const { data: mapping } = await db
    .from("circle_member_mapping")
    .select("circle_member_id")
    .eq("supabase_user_id", userId)
    .single();

  if (!mapping?.circle_member_id) return { ok: true, skipped: true }; // no Circle account

  try {
    await circle.createEventAttendee(circleEventId, mapping.circle_member_id);
    return { ok: true };
  } catch (err) {
    // 422 = already an attendee — not an error
    const status = (err as { status?: number })?.status;
    if (status === 422) return { ok: true };
    console.error("[circle/event-sync] pushRsvpToCircle failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Full sync: run all reconciliation (used by cron)
// ---------------------------------------------------------------------------

export async function runFullCircleEventSync(): Promise<{
  pull: { inserted: number; updated: number; skipped: number; errors: number };
  rsvps: { events: number; outOfWindow: number; synced: number; created: number; errors: number };
}> {
  // 1. Pull Circle events → website
  const pull = await pullCircleEvents();

  // 2. Sync RSVPs for events that have a circle_event_id AND are still live
  //    enough for their attendee list to change. One Circle call per event per
  //    run, so the window is what keeps this from growing without bound.
  const db = createAdminClient();
  const { data: events } = await db
    .from("events")
    .select("id, metadata, starts_at, ends_at")
    .eq("status", "published");

  const rsvps = { events: 0, outOfWindow: 0, synced: 0, created: 0, errors: 0 };
  const now = Date.now();

  for (const event of events ?? []) {
    const circleEventId = getCircleEventId(event.metadata);
    if (!circleEventId) continue;

    if (!isInRsvpSyncWindow(event, now)) {
      rsvps.outOfWindow++;
      continue;
    }

    rsvps.events++;
    const result = await syncEventRsvps(event.id, circleEventId);
    rsvps.synced += result.synced;
    rsvps.created += result.created;
    rsvps.errors += result.errors;
  }

  return { pull, rsvps };
}
