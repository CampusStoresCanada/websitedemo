import { NextRequest, NextResponse } from "next/server";
import { runFullCircleEventSync } from "@/lib/circle/event-sync";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Hourly cron: bidirectional Circle ↔ website event sync.
 *
 * 1. Pull new/updated Circle events → insert or update as website events
 * 2. Reconcile Circle RSVPs → create event_registrations for matched users
 *
 * Website → Circle push is handled inline at publish time (approveEvent action).
 * This cron handles the inbound direction + RSVP catch-up.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFullCircleEventSync();
    console.log("[cron/circle-event-sync]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/circle-event-sync] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
