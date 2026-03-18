// GET /api/admin/calendar/heartbeat
//
// Option A source-watermark polling:
//   1. Compute max(updated_at) across all 12 source tables.
//   2. Compare against max(updated_at) on calendar_items.
//   3. If any source changed since the last sync → run syncAndFetchCalendar().
//   4. Return the current calendar watermark.
//
// The client (CalendarAutoRefresh) calls router.refresh() only when the
// returned watermark differs from the previously seen value.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSourceWatermark,
  getCalendarWatermark,
  syncAndFetchCalendar,
} from "@/lib/calendar/aggregation";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("global_role")
    .eq("id", userId)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.global_role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check whether any source table has changed since the last calendar sync.
  const [sourceWatermark, calendarWatermark] = await Promise.all([
    getSourceWatermark(),
    getCalendarWatermark(),
  ]);

  const needsSync =
    sourceWatermark !== null &&
    (calendarWatermark === null || sourceWatermark > calendarWatermark);

  if (needsSync) {
    await syncAndFetchCalendar();
  }

  // Return the (potentially updated) calendar watermark to the client.
  const finalWatermark = needsSync ? await getCalendarWatermark() : calendarWatermark;
  return NextResponse.json({ watermark: finalWatermark ?? "empty" });
}
