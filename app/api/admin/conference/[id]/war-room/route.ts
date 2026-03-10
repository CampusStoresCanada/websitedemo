import { NextRequest, NextResponse } from "next/server";
import { listConferencePeople } from "@/lib/actions/conference-people";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";

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
  const result = await listConferencePeople(conferenceId);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Failed to load war-room data." },
      { status: 500 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const personKind = (searchParams.get("person_kind") ?? "").trim().toLowerCase();
  const assignmentStatus = (searchParams.get("assignment_status") ?? "")
    .trim()
    .toLowerCase();
  const badgeStatus = (searchParams.get("badge_status") ?? "").trim().toLowerCase();
  const checkIn = (searchParams.get("check_in") ?? "").trim().toLowerCase();

  const filtered = (result.data ?? []).filter((row) => {
    const queryOk =
      q.length === 0 ||
      (row.display_name ?? "").toLowerCase().includes(q) ||
      (row.contact_email ?? "").toLowerCase().includes(q) ||
      (row.organization_id ?? "").toLowerCase().includes(q);
    const kindOk = personKind.length === 0 || row.person_kind.toLowerCase() === personKind;
    const assignmentOk =
      assignmentStatus.length === 0 ||
      row.assignment_status.toLowerCase() === assignmentStatus;
    const badgeOk =
      badgeStatus.length === 0 || row.badge_print_status.toLowerCase() === badgeStatus;
    const checkInOk =
      checkIn.length === 0
        ? true
        : checkIn === "checked_in"
          ? Boolean(row.checked_in_at)
          : checkIn === "not_checked_in"
            ? !row.checked_in_at
            : true;
    return queryOk && kindOk && assignmentOk && badgeOk && checkInOk;
  });

  return NextResponse.json({ rows: filtered });
}
