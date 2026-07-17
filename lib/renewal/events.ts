import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";

export type RenewalEventType =
  | "reminder_30"
  | "reminder_14"
  | "reminder_7"
  | "reminder_0"
  | "invoice_generated"
  | "charge_attempted"
  | "charge_succeeded"
  | "charge_failed"
  | "grace_started"
  | "grace_reminder"
  | "access_locked"
  | "reactivation_payment"
  | "opt_out";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Check if a renewal event already exists for this org/year/type. */
export async function hasRenewalEventForOrgYear(
  db: AdminClient,
  orgId: string,
  year: number,
  eventType: RenewalEventType
): Promise<boolean> {
  const { data } = await db
    .from("renewal_events")
    .select("id")
    .eq("organization_id", orgId)
    .eq("renewal_year", year)
    .eq("event_type", eventType)
    .limit(1)
    .maybeSingle();

  return !!data;
}

/** Record a renewal event. */
export async function recordRenewalEvent(
  db: AdminClient,
  orgId: string,
  year: number,
  eventType: RenewalEventType,
  invoiceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.from("renewal_events").insert({
    organization_id: orgId,
    renewal_year: year,
    event_type: eventType,
    invoice_id: invoiceId ?? null,
    metadata: metadata
      ? (JSON.parse(JSON.stringify(metadata)) as Json)
      : null,
  });
}
