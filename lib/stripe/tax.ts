import { createAdminClient } from "@/lib/supabase/admin";

// ─────────────────────────────────────────────────────────────────
// Tax rate resolution — membership/partnership dues are taxed by the
// buyer's own province (origin-based), mirroring resolveMembershipTaxCode
// in lib/quickbooks/export.ts. Conference commerce's tax is destination-
// based (one flat conference.stripe_tax_rate_id) and is resolved
// independently, not here. Shared by the prospective-booth checkout
// (lib/actions/prospective-booth-checkout.ts) and the real renewal
// invoicing path (createMembershipInvoice/createPartnershipInvoice below).
// ─────────────────────────────────────────────────────────────────

const STRIPE_MEMBERSHIP_TAX_RATE_IDS_KEY = "stripe_membership_tax_rate_ids";
const STRIPE_TAX_RATE_ID_OUTSIDE_CANADA_KEY = "stripe_tax_rate_id_outside_canada";

interface StripeMembershipTaxRateMapping {
  province: string;
  stripeTaxRateId: string;
}

/**
 * Resolve the Stripe Tax Rate object ID for a membership/partnership line
 * item, from the buyer's own province. Configured in
 * /admin/settings/quickbooks as a province → Stripe Tax Rate ID list (same
 * shape/admin surface as the QBO mapping). No silent guessing: a province
 * not in the mapping throws, since mistaxing a real payment is worse than a
 * clear config error a human can fix.
 */
export async function resolveMembershipStripeTaxRateId(
  db: ReturnType<typeof createAdminClient>,
  province: string
): Promise<string> {
  const isOutsideCanada = province.trim().toLowerCase() === "out of canada";

  if (isOutsideCanada) {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", STRIPE_TAX_RATE_ID_OUTSIDE_CANADA_KEY)
      .single();
    if (data?.value) return data.value;
  } else {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", STRIPE_MEMBERSHIP_TAX_RATE_IDS_KEY)
      .single();

    if (data?.value) {
      try {
        const mappings: StripeMembershipTaxRateMapping[] = JSON.parse(data.value);
        const match = mappings.find((m) => m.province.trim().toLowerCase() === province.trim().toLowerCase());
        if (match?.stripeTaxRateId) return match.stripeTaxRateId;
      } catch {
        // fall through to error below
      }
    }
  }

  throw new Error(
    `No Stripe tax rate configured for province "${province}". Set it in /admin/settings/quickbooks.`
  );
}
