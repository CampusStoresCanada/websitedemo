import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatePrintStation, finishJob, stationMayReadJob } from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/**
 * How it went. `retry`: a PRINTER problem (wrong roll, out of film) — back to
 * the queue to print once it is fixed. Otherwise a failure is final.
 */
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const { jobId } = await context.params;
  if (!(await stationMayReadJob(station, jobId))) {
    return NextResponse.json({ error: "That job is not this station's." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { ok?: boolean; retry?: boolean; error?: string };
  const { data: job } = await createAdminClient().from("badge_print_jobs").select("person_id").eq("id", jobId).maybeSingle();
  await finishJob(station, jobId, (job?.person_id as string | null) ?? null, {
    ok: body.ok === true,
    retry: body.retry === true,
    error: typeof body.error === "string" ? body.error : null,
  });
  return NextResponse.json({ ok: true });
}
