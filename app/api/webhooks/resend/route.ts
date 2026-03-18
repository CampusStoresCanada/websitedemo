import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const computed = createHmac("sha256", key).update(toSign).digest("base64");
  const computedBuf = Buffer.from(computed);

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

  // Only handle delivery-outcome events
  const actionableTypes = new Set([
    "email.delivered",
    "email.bounced",
    "email.complained",
  ]);

  if (!actionableTypes.has(type)) {
    return NextResponse.json({ ok: true, skipped: `unhandled type: ${type}` });
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();

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

  return NextResponse.json({ ok: true, type, emailId });
}
