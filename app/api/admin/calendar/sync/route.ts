// POST /api/admin/calendar/sync
// Triggers aggregation upsert from all source systems, returns item count.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAndFetchCalendar } from "@/lib/calendar/aggregation";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("global_role")
    .eq("id", userId)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.global_role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await syncAndFetchCalendar();
  return NextResponse.json({ synced_at: result.synced_at, item_count: result.items.length });
}
