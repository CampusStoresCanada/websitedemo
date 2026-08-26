import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { canPauseCircleBadge, setCircleBadgePaused } from "@/lib/circle/badge-preference";

export const dynamic = "force-dynamic";

/**
 * POST /api/circle/badge-preference  { paused: boolean }
 *
 * Pauses or resumes this account's own Circle notification poll. Mutating on
 * POST only — a GET toggle would flip itself the moment a link scanner
 * pre-fetched the URL.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticated();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!canPauseCircleBadge(auth.ctx.userEmail)) {
    return NextResponse.json({ error: "Not available for this account" }, { status: 403 });
  }

  let body: { paused?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* no body */
  }

  if (typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "`paused` must be a boolean" }, { status: 400 });
  }

  const ok = await setCircleBadgePaused(auth.ctx.userId, auth.ctx.userEmail, body.paused);
  if (!ok) return NextResponse.json({ error: "Could not save preference" }, { status: 500 });

  return NextResponse.json({ ok: true, paused: body.paused }, { status: 200 });
}
