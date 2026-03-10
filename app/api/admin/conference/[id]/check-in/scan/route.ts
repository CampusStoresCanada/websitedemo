import { NextRequest, NextResponse } from "next/server";
import { scanConferenceCheckInToken } from "@/lib/actions/conference-people";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: conferenceId } = await context.params;

  let payload: {
    qr_token?: string;
    scan_timestamp?: string;
    device_id?: string;
  };

  try {
    payload = (await request.json()) as {
      qr_token?: string;
      scan_timestamp?: string;
      device_id?: string;
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
