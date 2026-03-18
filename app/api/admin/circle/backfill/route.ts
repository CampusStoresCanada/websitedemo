import { NextRequest, NextResponse } from "next/server";
import { backfillCircleMemberMapping } from "@/lib/circle/cutover";
import { getServerAuthState } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/circle/backfill
 * Body: { dryRun?: boolean; limit?: number }
 *
 * Runs the Circle member mapping backfill.
 * Requires super_admin.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = Boolean(body.dryRun ?? false);
  const limit = typeof body.limit === "number" ? body.limit : 500;

  const result = await backfillCircleMemberMapping({ dryRun, limit });
  return NextResponse.json(result);
}
