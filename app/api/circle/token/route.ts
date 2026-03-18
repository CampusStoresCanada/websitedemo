import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { resolveUserCircleId } from "@/lib/circle/member-link";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/circle/token — mint a Circle member token for the current user
// This is for server-side use only. The token is returned but should
// only be used by trusted server-side callers.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Suppress unused var warning — request is needed for route handler signature
  void request;

  if (!isCircleConfigured()) {
    return NextResponse.json(
      { error: "Circle not configured" },
      { status: 503 }
    );
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const circleId = await resolveUserCircleId(auth.ctx.userId, auth.ctx.userEmail);
    if (!circleId) {
      return NextResponse.json(
        { error: "Account not linked to Circle" },
        { status: 400 }
      );
    }

    // Mint token
    const token = await mintMemberToken({
      community_member_id: circleId,
    });

    return NextResponse.json({
      access_token: token.access_token,
      community_member_id: token.community_member_id,
      expires_at: token.access_token_expires_at,
    });
  } catch (err) {
    console.error(
      "[api/circle/token] Error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Failed to mint Circle token" },
      { status: 500 }
    );
  }
}
