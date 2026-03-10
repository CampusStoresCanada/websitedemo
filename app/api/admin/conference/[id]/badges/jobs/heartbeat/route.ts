import { NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: conferenceId } = await context.params;
  const db = createAdminClient();

  const { data, error } = await db
    .from("badge_print_jobs")
    .select("id, updated_at")
    .eq("conference_id", conferenceId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const latest = (data?.[0] as { id?: string; updated_at?: string } | undefined) ?? null;
  const watermark = latest
    ? `${latest.updated_at ?? "0"}:${latest.id ?? "none"}`
    : "empty";

  return NextResponse.json(
    { watermark },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

