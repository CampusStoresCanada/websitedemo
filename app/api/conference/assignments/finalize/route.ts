import { NextResponse } from "next/server";
import { finalizePendingConferenceAssignmentsForCurrentUser } from "@/lib/actions/conference-people";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await finalizePendingConferenceAssignmentsForCurrentUser();

  if (!result.success) {
    const status =
      result.error?.toLowerCase().includes("not authenticated") ||
      result.error?.toLowerCase().includes("admin access required")
        ? 401
        : 500;
    return NextResponse.json(
      { error: result.error ?? "Failed to finalize conference assignments." },
      { status }
    );
  }

  return NextResponse.json({
    finalized_count: result.data?.finalizedCount ?? 0,
    person_ids: result.data?.personIds ?? [],
  });
}

