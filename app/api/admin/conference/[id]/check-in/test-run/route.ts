import { NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { countTestCheckIns, resetTestCheckIns } from "@/lib/actions/conference-people";

export const dynamic = "force-dynamic";

/**
 * How much rehearsal is still sitting in the real numbers.
 *
 * ⛔ GET is a plain read and stays that way — the desk polls it, and anything
 * that mutates on GET is one link-scanner away from wiping a live count.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const result = await countTestCheckIns(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result.data);
}

/** Undo the rehearsal. Scoped by the flag on the rows, never by time. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const result = await resetTestCheckIns(id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result.data);
}
