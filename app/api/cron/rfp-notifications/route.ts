import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMatchingPartners } from "@/lib/rfps/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const now = new Date().toISOString();

  // Find RFPs that have opened but haven't been notified yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rfps, error } = await (db as any)
    .from("rfps")
    .select(`
      id, title, description, category, subcategories,
      opens_at, closes_at, visibility, organization_id,
      organization:organizations(name, slug)
    `)
    .eq("status", "active")
    .lte("opens_at", now)
    .gt("closes_at", now)
    .is("notifications_sent_at", null)
    .in("visibility", ["public", "network", "partners"]);

  if (error) {
    console.error("[cron/rfp-notifications] query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  if (!rfps?.length) {
    return NextResponse.json({ sent: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const rfp of rfps) {
    try {
      const org = rfp.organization as { name: string; slug: string } | null;

      await notifyMatchingPartners({
        rfpId: rfp.id,
        title: rfp.title,
        description: rfp.description,
        category: rfp.category,
        subcategories: rfp.subcategories ?? [],
        orgName: org?.name ?? "A CSC member",
        orgSlug: org?.slug ?? "",
        closesAt: rfp.closes_at,
        visibility: rfp.visibility,
      });

      // Mark as notified
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from("rfps")
        .update({ notifications_sent_at: now })
        .eq("id", rfp.id);

      sent++;
    } catch (e) {
      console.error("[cron/rfp-notifications] failed for rfp", rfp.id, e);
      failed++;
    }
  }

  console.log(`[cron/rfp-notifications] sent=${sent} failed=${failed}`);
  return NextResponse.json({ sent, failed });
}
