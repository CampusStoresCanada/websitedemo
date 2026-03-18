// GET  /api/admin/calendar/items  — fetch items (with optional layer filter)
// POST /api/admin/calendar/items  — create a manual item

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CreateManualItemPayload } from "@/lib/calendar/types";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { userId: null, error: "Unauthorized", status: 401 };

  const { data: profile } = await supabase
    .from("profiles")
    .select("global_role")
    .eq("id", userId)
    .single();

  if (!profile || !["admin", "super_admin"].includes(profile.global_role ?? "")) {
    return { userId: null, error: "Forbidden", status: 403 };
  }
  return { userId, error: null, status: 200 };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = req.nextUrl;
  const layer  = searchParams.get("layer");
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");

  const supabase = createAdminClient();
  let query = supabase
    .from("calendar_items")
    .select("*, owner:profiles!owner_id(id, full_name, email)")
    .order("starts_at", { ascending: true });

  if (layer) query = query.eq("layer", layer);
  if (from)  query = query.gte("starts_at", from);
  if (to)    query = query.lte("starts_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: CreateManualItemPayload;
  try {
    body = (await req.json()) as CreateManualItemPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.title || !body.category || !body.layer || !body.starts_at) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("calendar_items")
    .insert({
      title:       body.title,
      description: body.description ?? null,
      category:    body.category,
      layer:       body.layer,
      starts_at:   body.starts_at,
      ends_at:     body.ends_at ?? null,
      source_mode: "manual",
      source_key:  null,
      owner_id:    body.owner_id ?? auth.userId,
      status:      body.status  ?? "planned",
      severity:    body.severity ?? "normal",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data }, { status: 201 });
}
