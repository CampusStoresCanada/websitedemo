// POST /api/admin/calendar/items/[id]/notes
// GET  /api/admin/calendar/items/[id]/notes

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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
  const { data, error } = await admin
    .from("calendar_item_notes")
    .select("*, actor:profiles!actor_id(id, full_name, email)")
    .eq("calendar_item_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(
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

  let body: { note: string };
  try {
    body = (await req.json()) as { note: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.note?.trim()) {
    return NextResponse.json({ error: "Note cannot be empty" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_item_notes")
    .insert({
      calendar_item_id: id,
      note:             body.note.trim(),
      actor_id:         userId,
    })
    .select("*, actor:profiles!actor_id(id, full_name, email)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data }, { status: 201 });
}
