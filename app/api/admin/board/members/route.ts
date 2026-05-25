/**
 * GET /api/admin/board/members
 * Returns all admin/super_admin profiles for the action item assignee picker.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createAdminClient();

  // profiles.display_name + auth.users.email via a view or two-step
  const { data: profiles, error } = await db
    .from("profiles")
    .select("id, display_name, global_role")
    .in("global_role", ["admin", "super_admin"])
    .order("display_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch emails from auth.users for each profile
  const ids = (profiles ?? []).map((p) => p.id);
  const emailMap: Record<string, string> = {};

  if (ids.length > 0) {
    const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users ?? []) {
      if (ids.includes(u.id)) emailMap[u.id] = u.email ?? "";
    }
  }

  const members = (profiles ?? []).map((p) => ({
    id:           p.id,
    display_name: p.display_name ?? "Unknown",
    email:        emailMap[p.id] ?? "",
    global_role:  p.global_role,
  }));

  return NextResponse.json({ members });
}
