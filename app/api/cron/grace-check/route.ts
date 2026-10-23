import { NextRequest, NextResponse } from "next/server";
import { graceStateTransitionRun } from "@/lib/renewal/jobs";
import { expireOrgLinks } from "@/lib/org/org-link-lifecycle";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret — standard Vercel cron auth
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await graceStateTransitionRun();
    // A person's link to an organisation ends on its own date, the way an
    // organisation's membership ends on its. ⚠️ Isolated: a failure here must
    // never cost the grace transitions above their response.
    const orgLinks = await expireOrgLinks().catch((error: unknown) => ({
      expired: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    }));
    return NextResponse.json({ ...result, orgLinks });
  } catch (error) {
    console.error("[cron/grace-check] Unhandled error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
