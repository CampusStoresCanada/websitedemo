import { createAdminClient } from "@/lib/supabase/admin";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";

export type SalesOpenRunResult = {
  conferencesChecked: number;
  memberOpened: number;
  vendorOpened: number;
};

/**
 * Cron entry point: flips is_for_sale=true for any conference_entities whose
 * scheduled open time has arrived. Two independent windows per conference —
 * entities tagged sales_window='member' gate on
 * conference_instances.registration_open_at, sales_window='vendor' entities
 * gate on booth_sales_general_open_at — so registration and booth sales can
 * go live on different days. Entities with no sales_window are untouched
 * (opt-in only; still toggled manually as before). Idempotent: only flips
 * entities still marked not-for-sale, so running every minute indefinitely
 * is always safe — a conference whose time has long passed is just a no-op
 * once everything in that window is already on.
 */
export async function runScheduledSalesOpen(): Promise<SalesOpenRunResult> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const result: SalesOpenRunResult = { conferencesChecked: 0, memberOpened: 0, vendorOpened: 0 };

  const { data: conferences, error } = await db
    .from("conference_instances")
    .select("id, name, registration_open_at, booth_sales_general_open_at");

  if (error) {
    console.error("[conference-sales-open] fetch failed:", error.message);
    return result;
  }

  for (const conf of conferences ?? []) {
    const windows: { key: "member" | "vendor"; openAt: string | null }[] = [
      { key: "member", openAt: conf.registration_open_at },
      { key: "vendor", openAt: conf.booth_sales_general_open_at },
    ];

    let touched = false;
    for (const { key, openAt } of windows) {
      if (!openAt || openAt > now) continue;
      touched = true;

      const { data: opened, error: flipError } = await db
        .from("conference_entities")
        .update({ is_for_sale: true })
        .eq("conference_id", conf.id)
        .eq("sales_window", key)
        .eq("is_for_sale", false)
        .select("id");

      if (flipError) {
        console.error(`[conference-sales-open] ${key} flip failed for ${conf.id}:`, flipError.message);
        await raiseAlertIfNotOpen({
          ruleKey: `conference_sales_open_failed:${key}:${conf.id}`,
          severity: "critical",
          message: `Scheduled ${key} sales open failed for "${conf.name}": ${flipError.message}`,
          details: { conferenceId: conf.id, window: key, error: flipError.message },
        });
        continue;
      }

      const count = opened?.length ?? 0;
      if (count > 0) {
        console.log(`[conference-sales-open] Opened ${count} ${key} entities for "${conf.name}"`);
      }
      if (key === "member") result.memberOpened += count;
      else result.vendorOpened += count;
    }

    if (touched) result.conferencesChecked++;
  }

  return result;
}
