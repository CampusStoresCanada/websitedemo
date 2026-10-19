import { NextRequest, NextResponse } from "next/server";
import { scanConferenceCheckInToken } from "@/lib/actions/conference-people";
import { requireConferenceDeskAccess } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: deskConferenceId } = await context.params;
  const auth = await requireConferenceDeskAccess(deskConferenceId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: conferenceId } = await context.params;

  let payload: {
    qr_token?: string;
    scan_timestamp?: string;
    device_id?: string;
    test_mode?: boolean;
    as_of?: string | null;
  };

  try {
    payload = (await request.json()) as {
      qr_token?: string;
      scan_timestamp?: string;
      device_id?: string;
      test_mode?: boolean;
      as_of?: string | null;
    };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (!payload.qr_token || payload.qr_token.trim().length === 0) {
    return NextResponse.json(
      { error: "qr_token is required." },
      { status: 400 }
    );
  }

  const result = await scanConferenceCheckInToken({
    conferenceId,
    qrToken: payload.qr_token,
    scanTimestamp: payload.scan_timestamp ?? null,
    deviceId: payload.device_id ?? null,
    // ⛔ Only ever true because the caller said so. There is no server-side or
    // per-conference test flag to leave switched on by accident: a rehearsal is
    // something you are doing right now, in this tab.
    testMode: payload.test_mode === true,
    // Rehearsal only; the action ignores it outside test mode.
    asOf: payload.as_of ?? null,
  });

  if (!result.success) {
    const lowerError = result.error?.toLowerCase() ?? "";
    const status =
      lowerError.includes("access required") || lowerError.includes("not authorized")
        ? 403
        : 500;
    return NextResponse.json(
      { error: result.error ?? "Failed to process check-in scan." },
      { status }
    );
  }

  return NextResponse.json({
    state: result.data?.state ?? "invalid_token",
    person_id: result.data?.personId ?? null,
    checked_in_at: result.data?.checkedInAt ?? null,
  });
}
