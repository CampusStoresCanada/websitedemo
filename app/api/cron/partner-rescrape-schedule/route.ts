import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Quarterly cron: drops a blocked + requires_confirmation calendar item
 * for the partner directory rescrape. A super_admin must confirm it in the
 * admin calendar before the nightly embed cron will run force_rescrape.
 *
 * Schedule: 0 9 1 1,4,7,10 * (1st of Jan, Apr, Jul, Oct at 9am UTC)
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Don't create a duplicate if one is already pending confirmation
  const { data: existing } = await supabase
    .from("calendar_items")
    .select("id")
    .eq("source_key", "partner_rescrape")
    .in("status", ["blocked", "planned"])
    .is("confirmed_at", null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, reason: "pending item already exists" });
  }

  const now   = new Date();
  const month = now.toLocaleString("en-CA", { month: "long", timeZone: "America/Toronto" });
  const year  = now.getFullYear();

  const { error } = await supabase.from("calendar_items").insert({
    title:                `Partner Directory Rescrape — ${month} ${year}`,
    description:
      "Quarterly re-enrichment of all Vendor Partner profiles: website scrape → Claude Haiku summary → Voyage embedding. " +
      "Confirm to authorize the nightly cron to run force_rescrape on the next cycle. " +
      "Estimated cost: ~$3–5 in API calls across ~120 partners.",
    category:             "integrations_ops",
    layer:                "system_ops",
    starts_at:            now.toISOString(),
    source_mode:          "projected",
    source_key:           "partner_rescrape",
    related_entity_type:  "partner_rescrape",
    status:               "blocked",
    severity:             "warning",
    requires_confirmation: true,
    confirmed_at:         null,
    confirmed_by:         null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, created: true });
}
