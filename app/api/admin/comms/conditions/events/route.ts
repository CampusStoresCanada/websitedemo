import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/comms/conditions/events — options for the "which event"
 * reference picker when a condition's subject is Event Registration.
 */
export async function GET() {
  const db = createAdminClient();
  const { data, error } = await db
    .from("events")
    .select("id, title, starts_at")
    .order("starts_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ options: (data ?? []).map((e) => ({ id: e.id, title: e.title })) });
}
