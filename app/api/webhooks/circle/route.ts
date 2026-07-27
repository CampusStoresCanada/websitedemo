import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { enqueueCircleSync } from "@/lib/circle/sync";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Circle webhook auth
//
// Circle's Workflow webhooks don't use HMAC signing. Instead, configure a
// custom header in the Circle workflow action:
//   Header name:  Authorization
//   Header value: Bearer <your CIRCLE_WEBHOOK_SECRET>
//
// The route verifies this Bearer token with a timing-safe comparison.
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = process.env.CIRCLE_WEBHOOK_SECRET;

function verifyToken(request: NextRequest): boolean {
  if (!WEBHOOK_SECRET) return false;

  // Check multiple header locations — Circle workflows may not support
  // the Authorization header, so also check X-Webhook-Secret and a query param.
  const candidates = [
    request.headers.get("x-webhook-secret"),
    request.headers.get("x-circle-secret"),
    (() => {
      const auth = request.headers.get("authorization");
      if (!auth) return null;
      return auth.startsWith("Bearer ") ? auth.slice(7) : auth;
    })(),
    new URL(request.url).searchParams.get("secret"),
  ];

  for (const token of candidates) {
    if (!token) continue;
    try {
      if (
        token.length === WEBHOOK_SECRET.length &&
        crypto.timingSafeEqual(
          Buffer.from(token, "utf8"),
          Buffer.from(WEBHOOK_SECRET, "utf8")
        )
      ) {
        return true;
      }
    } catch {
      // length mismatch throws — continue
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Circle field key → Supabase column mapping
//
// Circle custom profile fields use the key you set in the community admin.
// Add entries here as you discover the actual keys in your community.
// Canonical fields are written to proper DB columns; everything else lands
// in circle_properties (JSONB) for non-canonical storage.
// ---------------------------------------------------------------------------

// Confirmed Circle profile field keys for this community (Settings → Profile Fields).
// Only fields that map to a dedicated contacts column go here.
// Everything else lands in circle_properties JSONB automatically.
//   jobtitle        → role_title  (confirmed)
//   birthday        → circle_properties
//   topic_preferences → circle_properties (field being replaced — ignore for now)
//   location        → circle_properties
const CANONICAL_FIELD_MAP: Record<string, "role_title"> = {
  jobtitle: "role_title",
};

// ---------------------------------------------------------------------------
// Event type handlers
// ---------------------------------------------------------------------------

// Minimal shape of a Circle webhook payload
// Circle wraps events in { body: { type, data } }
interface CircleWebhookEvent {
  type: string;
  community_id?: number;
  data?: Record<string, unknown>;
}

async function handleMemberCreated(data: Record<string, unknown>): Promise<void> {
  const email = String(data.email ?? "");
  const name = String(data.name ?? data.display_name ?? "");
  const circleId = Number(data.id);

  if (!email || !circleId) return;

  // Find the matching contact by email and enqueue a link operation
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const { data: contact } = await db
    .from("contacts")
    .select("id, organization_id")
    .eq("email", email)
    .is("circle_id", null)
    .limit(1)
    .maybeSingle();

  if (!contact) return; // No matching unlinked contact — nothing to do

  await enqueueCircleSync({
    operation: "link_member",
    entityType: "contact",
    entityId: contact.id,
    payload: { email, name, circleId },
    orgId: contact.organization_id ?? undefined,
    idempotencyKey: `webhook-link-${contact.id}`,
  });
}

async function handleMemberUpdated(data: Record<string, unknown>): Promise<void> {
  const email = String(data.email ?? "");
  const circleId = Number(data.id);

  if (!email || !circleId) return;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const nonCanonical: Record<string, unknown> = {};
  if (data.headline) nonCanonical.headline = data.headline;
  if (data.bio) nonCanonical.bio = data.bio;
  if (data.avatar_url) nonCanonical.avatar_url = data.avatar_url;

  // Circle's "name" is a core member attribute (not a custom profile field,
  // so community_member_profile_field_updated never carries it) — apply it
  // with last-write-wins: only take Circle's name if it changed more
  // recently than this contact was last edited on our side. No per-field
  // timestamp exists, so we use the whole-row contacts.updated_at as a
  // deliberately simple heuristic (see plan notes) against Circle's event
  // time if present, falling back to webhook-receipt time otherwise.
  const incomingName = typeof data.name === "string" ? data.name : null;
  let nameUpdate: { name: string } | null = null;

  if (incomingName) {
    const circleEventAt =
      typeof data.updated_at === "string" ? new Date(data.updated_at) : new Date();

    const { data: contact } = await db
      .from("contacts")
      .select("id, name, updated_at")
      .eq("email", email)
      .not("circle_id", "is", null)
      .maybeSingle();

    if (contact && contact.name !== incomingName) {
      const oursUpdatedAt = contact.updated_at ? new Date(contact.updated_at) : new Date(0);
      if (circleEventAt > oursUpdatedAt) {
        nameUpdate = { name: incomingName };
      } else {
        console.log(
          `[circle/webhook] name change for ${email} ignored — our record (updated ${contact.updated_at}) is newer than Circle's event`
        );
      }
    }
  }

  if (Object.keys(nonCanonical).length === 0 && !nameUpdate) return;

  // Intentional exception to identity lifecycle helper usage:
  // circle_properties is external-system engagement metadata, not identity data.
  await db
    .from("contacts")
    .update({
      ...(Object.keys(nonCanonical).length > 0
        ? { circle_properties: JSON.parse(JSON.stringify(nonCanonical)) }
        : {}),
      ...nameUpdate,
      synced_from_circle_at: new Date().toISOString(),
    })
    .eq("email", email)
    .not("circle_id", "is", null);
}

async function handleProfileFieldUpdated(data: Record<string, unknown>): Promise<void> {
  const circleId = Number(data.community_member_id);
  const fieldKey = String(data.profile_field_key ?? "");
  const fieldValue = String(data.profile_field_value ?? "");

  if (!circleId || !fieldKey) return;

  console.log(`[circle/webhook] profile_field_updated: circle_id=${circleId} key=${fieldKey} value=${fieldValue}`);

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // Find the contact by circle_id
  const { data: contact } = await db
    .from("contacts")
    .select("id, circle_properties")
    .eq("circle_id", String(circleId))
    .limit(1)
    .maybeSingle();

  if (!contact) {
    console.warn(`[circle/webhook] profile_field_updated: no contact for circle_id ${circleId}`);
    return;
  }

  const canonicalColumn = CANONICAL_FIELD_MAP[fieldKey];

  if (canonicalColumn) {
    // Canonical field — write to the proper column
    await db
      .from("contacts")
      .update({
        [canonicalColumn]: fieldValue || null,
        synced_from_circle_at: new Date().toISOString(),
      })
      .eq("id", contact.id);
  } else {
    // Non-canonical — store in circle_properties JSONB
    const existing = (contact.circle_properties as Record<string, unknown>) ?? {};
    const updated = { ...existing, [fieldKey]: fieldValue };
    await db
      .from("contacts")
      .update({
        circle_properties: JSON.parse(JSON.stringify(updated)),
        synced_from_circle_at: new Date().toISOString(),
      })
      .eq("id", contact.id);
  }
}

async function handleMemberDestroyed(data: Record<string, unknown>): Promise<void> {
  const circleId = Number(data.id);
  if (!circleId) return;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { findUserByEmail } = await import("@/lib/supabase/user-lookup");
  const db = createAdminClient();

  // Supabase is the identity source of truth — the contacts row (name,
  // email, org association, CRM history) is never touched or deleted here.
  // What CAN change: if this person has a linked authenticated account,
  // their org membership is demoted so they lose member/partner access,
  // since they're no longer reachable in Circle.
  const { data: contact } = await db
    .from("contacts")
    .select("id, email")
    .eq("circle_id", String(circleId))
    .maybeSingle();

  if (!contact?.email) {
    console.log(`[circle/webhook] community_member.destroyed: no contact for circle_id ${circleId}`);
    return;
  }

  const user = await findUserByEmail(db, contact.email);
  if (!user) {
    console.log(`[circle/webhook] community_member.destroyed: contact ${contact.id} has no linked auth account — nothing to demote`);
    return;
  }

  // user_organizations.status is constrained to active/pending/rejected —
  // "rejected" is the closest fit for "no longer valid" among those three.
  // derivePermissionState() only counts status === "active", so this drops
  // every org membership for this user to public-tier access.
  const { error, data: demoted } = await db
    .from("user_organizations")
    .update({ status: "rejected" })
    .eq("user_id", user.id)
    .eq("status", "active")
    .select("id");

  if (error) {
    console.error(`[circle/webhook] community_member.destroyed: failed to demote user ${user.id}:`, error.message);
    return;
  }

  console.log(`[circle/webhook] community_member.destroyed: demoted ${demoted?.length ?? 0} active org membership(s) for user ${user.id} (contact ${contact.id}) — contacts row untouched`);
}

async function handlePostPublished(data: Record<string, unknown>): Promise<void> {
  // Announcement published — we don't need to do anything server-side today
  // (the ISR announcement feed refreshes on its own schedule).
  // Log for observability only.
  console.log("[circle/webhook] post.published", {
    post_id: data.id,
    space_id: data.space_id,
    title: data.name,
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Verify Bearer token
  if (!WEBHOOK_SECRET) {
    console.error("[circle/webhook] CIRCLE_WEBHOOK_SECRET is not set — rejecting all webhooks");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!verifyToken(request)) {
    console.warn("[circle/webhook] Token verification failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse event
  // Circle workflow webhooks wrap the payload in { body: { type, data } }
  let rawEvent: { body?: CircleWebhookEvent } | CircleWebhookEvent;
  try {
    rawEvent = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Unwrap Circle's { body: { ... } } envelope if present
  const event: CircleWebhookEvent =
    "body" in rawEvent && rawEvent.body
      ? rawEvent.body
      : (rawEvent as CircleWebhookEvent);

  const { type, data = {} } = event;

  // 4. Route by event type
  try {
    switch (type) {
      case "community_member.created":
        await handleMemberCreated(data);
        break;

      case "community_member.updated":
        await handleMemberUpdated(data);
        break;

      case "community_member_profile_field_updated":
        await handleProfileFieldUpdated(data);
        break;

      case "post.published":
      case "post.created":
        await handlePostPublished(data);
        break;

      case "community_member.destroyed":
        // Supabase is still the identity source of truth — the contacts row
        // is never touched or deleted. But their linked auth account (if
        // any) does get demoted to public-tier access, since they're no
        // longer reachable in Circle. See handleMemberDestroyed.
        await handleMemberDestroyed(data);
        break;

      default:
        // Unhandled event — acknowledge receipt so Circle doesn't retry
        console.log(`[circle/webhook] Unhandled event type: ${type}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[circle/webhook] Handler error for ${type}:`, msg);
    // Return 500 so Circle will retry — transient failures should be retried
    return NextResponse.json({ error: "Handler failed", message: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true, type });
}
