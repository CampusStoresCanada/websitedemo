import { NextRequest, NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { loadScheduleOpsSummary } from "@/lib/conference/schedule-ops";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: conferenceId } = await context.params;
  const selectedRunId = request.nextUrl.searchParams.get("selectedRunId");

  try {
    const summary = await loadScheduleOpsSummary(conferenceId, selectedRunId);
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load schedule operations summary.",
      },
      { status: 500 }
    );
  }
}

