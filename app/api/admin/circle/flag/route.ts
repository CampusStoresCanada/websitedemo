import { NextRequest, NextResponse } from "next/server";
import { setCircleCutoverFlag } from "@/lib/circle/cutover";
import type { CircleCutoverFlag } from "@/lib/circle/cutover";
import { getServerAuthState } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const ALLOWED_FLAGS = new Set<CircleCutoverFlag>([
  "integration.circle_cutover_enabled",
  "integration.circle_legacy_fallback_enabled",
  "integration.circle_canary_org_ids",
]);

/**
 * POST /api/admin/circle/flag
 * Body: { key: CircleCutoverFlag; value: unknown }
 *
 * Directly toggles a Circle feature flag. Bypasses the policy draft system —
 * this is the emergency kill switch path.
 * Requires super_admin.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { key, value } = body;

  if (!key || !ALLOWED_FLAGS.has(key as CircleCutoverFlag)) {
    return NextResponse.json(
      { error: `Invalid flag key. Allowed: ${[...ALLOWED_FLAGS].join(", ")}` },
      { status: 400 }
    );
  }

  const result = await setCircleCutoverFlag(key as CircleCutoverFlag, value);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
