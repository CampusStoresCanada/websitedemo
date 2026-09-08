import { NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { loadCheckInFacts } from "@/lib/conference/badges/checkin";

export const dynamic = "force-dynamic";

/**
 * The desk's entitlement map, refreshed on demand.
 *
 * ⛔ Deliberately NOT folded into the war-room poll the desk already runs every
 * 30 seconds. This costs a full badge run; on the poll it would be a thousand
 * extra catalogue walks over one day of check-in. The desk calls it when it
 * scans somebody it has no facts for — a walk-up registration — and takes the
 * whole map back, so the next few walk-ups are already covered.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id: conferenceId } = await context.params;
  try {
    return NextResponse.json(await loadCheckInFacts(conferenceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load check-in facts." },
      { status: 500 }
    );
  }
}
