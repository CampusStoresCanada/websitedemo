import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeEmail, GLOBAL_SUPPRESSION_CATEGORY } from "@/lib/comms/suppressions";

// ─────────────────────────────────────────────────────────────────
// Resend / Svix webhook signature verification
// ─────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "";

function verifySignature(
  rawBody: string,
  headers: {
    svixId: string;
    svixTimestamp: string;
    svixSignature: string;
  }
): boolean {
  if (!WEBHOOK_SECRET) return false;

  // Secret format: "whsec_<base64>"
  const secret = WEBHOOK_SECRET.startsWith("whsec_")
    ? WEBHOOK_SECRET.slice(6)
    : WEBHOOK_SECRET;

  const key = Buffer.from(secret, "base64");
  const toSign = `${headers.svixId}.${headers.svixTimestamp}.${rawBody}`;
  // Compare raw digest bytes, not text. svix sends the signature base64-encoded,
  // so the incoming value must be decoded to its 32 digest bytes and matched
  // against an equally raw digest — encoding one side as base64 text and the
  // other as bytes yields 44 vs 32 and never matches.
  const computedBuf = createHmac("sha256", key).update(toSign).digest();

  // svix-signature may contain multiple space-separated "v1,<sig>" values
  const sigs = headers.svixSignature.split(" ");
  for (const sig of sigs) {
    const [version, value] = sig.split(",");
    if (version !== "v1" || !value) continue;
    try {
      const sigBuf = Buffer.from(value, "base64");
      if (sigBuf.length === computedBuf.length && timingSafeEqual(sigBuf, computedBuf)) {
        return true;
      }
    } catch {
      // malformed base64 — skip
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Event handler
// ─────────────────────────────────────────────────────────────────

interface ResendWebhookPayload {
  type:
    | "email.sent"
    | "email.delivered"
    | "email.delivery_delayed"
    | "email.complained"
    | "email.bounced"
    | "email.opened"
    | "email.clicked";
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject?: string;
    created_at: string;
    bounced_at?: string;
    click?: { link: string; timestamp: string; ipAddress?: string; userAgent?: string };
    /** Present on email.bounced — classifies the bounce. Only "Permanent" (hard bounce, address doesn't exist) warrants auto-suppression; "Transient"/"Undetermined" bounces can resolve on their own. */
    bounce?: { type: "Permanent" | "Transient" | "Undetermined"; subType?: string; message?: string };
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";

  // Verify signature (skip in development if secret not configured)
  if (WEBHOOK_SECRET) {
    const valid = verifySignature(rawBody, {
      svixId,
      svixTimestamp,
      svixSignature,
    });
    if (!valid) {
      console.warn("[webhooks/resend] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, data } = payload;
  const emailId = data?.email_id;

  if (!emailId) {
    return NextResponse.json({ ok: true, skipped: "no email_id" });
  }

  const actionableTypes = new Set([
    "email.delivered",
    "email.bounced",
    "email.complained",
    "email.opened",
    "email.clicked",
  ]);

  if (!actionableTypes.has(type)) {
    return NextResponse.json({ ok: true, skipped: `unhandled type: ${type}` });
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();

  // Opens and clicks are engagement events, not delivery-lifecycle states —
  // they can arrive after "delivered" and don't replace it. Handled via RPC
  // (atomic counter bump) rather than the plain column update below.
  if (type === "email.opened" || type === "email.clicked") {
    const { data: delivery, error: lookupErr } = await adminClient
      .from("message_deliveries")
      .select("id, campaign_id")
      .eq("provider_message_id", emailId)
      .maybeSingle();

    if (lookupErr) {
      console.error("[webhooks/resend] delivery lookup failed:", lookupErr.message);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (!delivery) {
      return NextResponse.json({ ok: true, skipped: "no matching delivery" });
    }

    const rpcErr =
      type === "email.opened"
        ? (await adminClient.rpc("record_delivery_open", { p_delivery_id: delivery.id })).error
        : (
            await adminClient.rpc("record_delivery_click", {
              p_delivery_id: delivery.id,
              p_campaign_id: delivery.campaign_id,
              p_url: data.click?.link ?? "(unknown link)",
            })
          ).error;

    if (rpcErr) {
      console.error("[webhooks/resend] engagement RPC failed:", rpcErr.message);
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, type, emailId });
  }

  let updatePayload: Record<string, string>;
  switch (type) {
    case "email.delivered":
      updatePayload = { status: "delivered", delivered_at: now };
      break;
    case "email.bounced":
      updatePayload = {
        status: "bounced",
        bounced_at: data.bounced_at ?? now,
        error: "Bounced",
      };
      break;
    case "email.complained":
      updatePayload = { status: "complained", complained_at: now };
      break;
    default:
      return NextResponse.json({ ok: true });
  }

  const { error } = await adminClient
    .from("message_deliveries")
    .update(updatePayload)
    .eq("provider_message_id", emailId)
    .in("status", ["sent", "queued"]); // don't overwrite terminal states

  if (error) {
    console.error("[webhooks/resend] DB update failed:", error.message);
    // Return 500 so Resend retries
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Deliverability auto-suppression: a hard bounce means the address itself
  // is bad (not a category preference), and a spam complaint means the
  // recipient doesn't want commercial email from us at all — both warrant a
  // global suppression, not a per-category one. Soft/undetermined bounces
  // are transient and can resolve on their own, so they're logged on the
  // delivery above but don't suppress. Recipients of transactional email
  // are unaffected either way, since transactional sends bypass suppression
  // checks entirely (see executeCampaignSend).
  const isHardBounce = type === "email.bounced" && data.bounce?.type === "Permanent";
  const isComplaint = type === "email.complained";
  if (isHardBounce || isComplaint) {
    const recipientEmail = data.to?.[0];
    if (recipientEmail) {
      const reason = isComplaint
        ? "resend webhook: spam complaint"
        : `resend webhook: hard bounce${data.bounce?.subType ? ` (${data.bounce.subType})` : ""}`;
      const { error: suppressErr } = await unsubscribeEmail(recipientEmail, GLOBAL_SUPPRESSION_CATEGORY, reason);
      if (suppressErr) {
        console.error("[webhooks/resend] auto-suppression failed:", suppressErr);
      }
    }
  }

  return NextResponse.json({ ok: true, type, emailId });
}
