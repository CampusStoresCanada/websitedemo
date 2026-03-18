// PATCH /api/admin/calendar/items/[id]
// Updates status, severity, owner_id, or description.
// Projected items: only severity/owner_id allowed (read-only source data).
// Manual items: all fields allowed.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UpdateCalendarItemPayload } from "@/lib/calendar/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  const admin = createAdminClient();
  const { data: existing, error: fetchErr } = await admin
    .from("calendar_items")
    .select("id, source_mode")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: UpdateCalendarItemPayload;
  try {
    body = (await req.json()) as UpdateCalendarItemPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Projected items: only allow severity and owner_id updates.
  const update: Record<string, unknown> = {};
  if (body.severity  !== undefined) update.severity  = body.severity;
  if (body.owner_id  !== undefined) update.owner_id  = body.owner_id;
  if (existing.source_mode === "manual") {
    if (body.status      !== undefined) update.status      = body.status;
    if (body.description !== undefined) update.description = body.description;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("calendar_items")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
