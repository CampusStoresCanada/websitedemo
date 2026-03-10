import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractConferenceOrderIdFromStripeEvent,
  isHandledStripeWebhookEvent,
  processStripeWebhookEvent,
  recordConferenceWebhookEvent,
  toWebhookPayloadJson,
} from "@/lib/stripe/webhook-processing";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    console.error("Webhook signature verification failed:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!isHandledStripeWebhookEvent(event.type)) {
    return NextResponse.json({ received: true, skipped: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data: existing } = await db
    .from("stripe_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const context = await processStripeWebhookEvent(event, db);

    await db.from("stripe_webhook_events").insert({
      id: event.id,
      type: event.type,
      result: "success",
      payload: toWebhookPayloadJson(event),
    });

    await recordConferenceWebhookEvent({
      db,
      event,
      conferenceOrderId:
        context.conferenceOrderId ?? extractConferenceOrderIdFromStripeEvent(event),
      success: true,
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown processing error";
    console.error(`Webhook processing error [${event.type}]:`, errorMessage);

    await db.from("stripe_webhook_events").insert({
      id: event.id,
      type: event.type,
      result: "error",
      error_message: errorMessage,
      payload: toWebhookPayloadJson(event),
    });

    await recordConferenceWebhookEvent({
      db,
      event,
      conferenceOrderId: extractConferenceOrderIdFromStripeEvent(event),
      success: false,
      errorMessage,
    });

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
