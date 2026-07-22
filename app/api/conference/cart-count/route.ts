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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ac = adminClient as any;
  const [{ data: membership }, { data: conference }] = await Promise.all([
    ac
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .maybeSingle(),
    ac
      .from("conference_instances")
      .select("id")
      .eq("year", Number(year))
      .eq("edition_code", edition)
      .maybeSingle(),
  ]);

  if (!membership || !conference?.id) {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }

  // Same expiry rule getOfferCartRows() uses for the actual cart contents
  // (lib/actions/conference-commerce.ts) — without it, a lapsed reservation
  // still inflates this count even though the cart itself already treats it
  // as gone, so the header badge shows items the cart page doesn't.
  const now = new Date().toISOString();
  const { data: rows } = await ac
    .from("cart_items")
    .select("quantity")
    .eq("conference_id", conference.id)
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  const count = (rows ?? []).reduce((sum: number, row: any) => sum + row.quantity, 0);
  return NextResponse.json({ count }, { status: 200 });
}
