import { NextRequest, NextResponse } from "next/server";
import { dispatchMessaging } from "@/lib/comms/dispatch";
import { messagingSources } from "@/lib/comms/sources";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * The messaging dispatch.
 *
 * Still mounted at the onboarding path because onboarding is the only source
 * so far and the schedule entry already exists; it is renamed when the second
 * source joins. The job no longer "runs onboarding" — it asks every messaging
 * sender what it would write today, and sends the most pressing thing per
 * person.
 *
 * ⛔ Transactional mail never passes through here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchMessaging(messagingSources());
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/messaging-dispatch] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
