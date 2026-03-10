import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("year");
  const edition = request.nextUrl.searchParams.get("edition");
  const orgId = request.nextUrl.searchParams.get("org");

  if (!year || !edition || !orgId) {
    return NextResponse.json({ error: "Missing required query params." }, { status: 400 });
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
  const userId = auth.ctx.userId;
  const adminClient = createAdminClient();

  const [{ data: membership }, { data: conference }] = await Promise.all([
    adminClient
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .maybeSingle(),
    adminClient
      .from("conference_instances")
      .select("id")
      .eq("year", Number(year))
      .eq("edition_code", edition)
      .maybeSingle(),
  ]);

  if (!membership || !conference?.id) {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }

  const { data: rows } = await adminClient
    .from("cart_items")
    .select("quantity")
    .eq("conference_id", conference.id)
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  const count = (rows ?? []).reduce((sum, row) => sum + row.quantity, 0);
  return NextResponse.json({ count }, { status: 200 });
}
