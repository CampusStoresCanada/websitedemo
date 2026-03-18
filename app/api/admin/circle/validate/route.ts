import { NextResponse } from "next/server";
import { validateCutoverReadiness } from "@/lib/circle/cutover";
import { getServerAuthState } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/circle/validate
 * Runs pre-flight cutover validation checks.
 * Requires super_admin.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await validateCutoverReadiness();
  return NextResponse.json(result);
}
