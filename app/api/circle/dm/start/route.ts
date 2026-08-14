import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { getCircleClientForUser } from "@/lib/circle/member-session";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/circle/dm/start — create-or-reuse a direct chat room with a
// target Circle member (createDirectChatRoom is idempotent on Circle's
// side). Separate from POST /api/circle/dm, which sends into an ALREADY
// KNOWN room uuid — this resolves that room in the first place, e.g. for
// the admin membership directory's "message this org's contact" action.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!isCircleConfigured()) {
    return NextResponse.json({ error: "Circle not configured" }, { status: 503 });
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const config = await getIntegrationConfig();
    if (config.circle_dm_mode === "disabled") {
      return NextResponse.json({ error: "DMs are disabled" }, { status: 403 });
    }
  } catch {
    // Policy engine unavailable — allow
  }

  try {
    const body = await request.json();
    const { targetCircleId } = body as { targetCircleId?: number };

    if (!targetCircleId || typeof targetCircleId !== "number") {
      return NextResponse.json({ error: "targetCircleId is required" }, { status: 400 });
    }

    const memberClient = await getCircleClientForUser(auth.ctx.userId, auth.ctx.userEmail);
    if (!memberClient) {
      return NextResponse.json(
        { error: "Your account is not linked to Circle" },
        { status: 400 }
      );
    }

    const room = await memberClient.createDirectChatRoom(targetCircleId);

    return NextResponse.json({ room });
  } catch (err) {
    console.error("[api/circle/dm/start] POST error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to start conversation" }, { status: 500 });
  }
}
