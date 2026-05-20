import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = "https://kalosjtiwtnwsseitfys.supabase.co";
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/embed-partner`;

/**
 * Nightly cron: re-embed any Vendor Partner org whose embedding is stale
 * (embedding IS NULL or embedding_updated_at IS NULL).
 *
 * The DB trigger marks embedding_updated_at = NULL whenever a searchable
 * text field changes, so this picks up both new orgs and recent edits.
 *
 * Vercel cron schedule: 0 3 * * *  (3am UTC daily)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Check for a confirmed quarterly rescrape calendar item
  const { data: rescrapeItem } = await supabase
    .from("calendar_items")
    .select("id, confirmed_at")
    .eq("source_key", "partner_rescrape")
    .eq("status", "planned")
    .not("confirmed_at", "is", null)
    .maybeSingle();

  const forceRescrape = !!rescrapeItem;

  // Find stale partner orgs: embedding stale, website never summarized, or force rescrape all
  const query = supabase
    .from("organizations")
    .select("id, name")
    .eq("type", "Vendor Partner");

  const { data: stale, error } = forceRescrape
    ? await query
    : await query.or("embedding.is.null,embedding_updated_at.is.null,website_summary.is.null");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: "All embeddings up to date" });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const results = { processed: 0, errors: [] as string[] };

  for (const org of stale) {
    try {
      const res = await fetch(EDGE_FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ org_id: org.id, force_rescrape: forceRescrape }),
      });

      if (!res.ok) {
        const text = await res.text();
        results.errors.push(`${org.name}: ${text}`);
      } else {
        results.processed++;
      }
    } catch (e) {
      results.errors.push(`${org.name}: ${(e as Error).message}`);
    }
  }

  // Mark the rescrape calendar item as done so the next quarterly cron can create a fresh one
  if (forceRescrape && rescrapeItem && results.errors.length === 0) {
    await supabase
      .from("calendar_items")
      .update({ status: "done" })
      .eq("id", rescrapeItem.id);
  }

  return NextResponse.json({
    ok: true,
    force_rescrape: forceRescrape,
    total_stale: stale.length,
    ...results,
  });
}
