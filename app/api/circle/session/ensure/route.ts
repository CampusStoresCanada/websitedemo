import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { resolveUserCircleId } from "@/lib/circle/member-link";
import { getIntegrationConfig } from "@/lib/policy/engine";

export const dynamic = "force-dynamic";

/**
 * POST /api/circle/session/ensure
 * Ensures a headless Circle session can be minted for the current user,
 * without returning the token to the browser.
 */
export async function POST() {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let cutoverEnabled = false;
  try {
    const config = await getIntegrationConfig();
    cutoverEnabled = Boolean(config.circle_cutover_enabled);
  } catch {
    cutoverEnabled = false;
  }

  if (!cutoverEnabled) {
    return NextResponse.json({ ok: true, skipped: "cutover_disabled" }, { status: 200 });
  }

  if (!isCircleConfigured()) {
    return NextResponse.json({ ok: true, skipped: "circle_not_configured" }, { status: 200 });
  }

  try {
    const circleId = await resolveUserCircleId(auth.ctx.userId, auth.ctx.userEmail);
    if (!circleId) {
      return NextResponse.json({ ok: true, linked: false }, { status: 200 });
    }

    await mintMemberToken({ email: auth.ctx.userEmail });

    return NextResponse.json({ ok: true, linked: true }, { status: 200 });
  } catch (error) {
    console.error(
      "[api/circle/session/ensure] Failed to ensure Circle member session:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { ok: false, error: "Failed to ensure Circle member session" },
      { status: 503 }
    );
  }
}
