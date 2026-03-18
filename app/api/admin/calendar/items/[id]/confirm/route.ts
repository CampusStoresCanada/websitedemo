import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth — require admin+
  const authClient = await createServerClient();
  const { data: claimsData } = await authClient.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authClient
    .from("profiles")
    .select("global_role")
    .eq("id", userId)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.global_role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Confirm the item
  const supabase = createAdminClient();

  const { data: item } = await supabase
    .from("calendar_items")
    .select("id, requires_confirmation, confirmed_at, status")
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!item.requires_confirmation) {
    return NextResponse.json({ error: "This item does not require confirmation" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("calendar_items")
    .update({
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      // De-escalate: confirmed items are no longer blocked
      status:   item.status === "blocked" ? "planned" : item.status,
      severity: "normal",
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, confirmed_at: updated.confirmed_at });
}

// DELETE — revoke confirmation (super_admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const authClient = await createServerClient();
  const { data: claimsData } = await authClient.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authClient
    .from("profiles")
    .select("global_role")
    .eq("id", userId)
    .single();

  if (profile?.global_role !== "super_admin") {
    return NextResponse.json({ error: "Only super_admins can revoke confirmations" }, { status: 403 });
  }

  const supabase = createAdminClient();
  await supabase
    .from("calendar_items")
    .update({ confirmed_at: null, confirmed_by: null })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
