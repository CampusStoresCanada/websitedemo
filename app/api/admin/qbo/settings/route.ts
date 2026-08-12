/**
 * POST /api/admin/qbo/settings — save QBO item-mapping settings (SA only)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

interface PriceBandInput {
  maxAmount: number;
  itemId: string | null;
}

interface MembershipTaxCodeInput {
  province: string;
  taxCodeId: string | null;
}

interface StripeMembershipTaxRateInput {
  province: string;
  stripeTaxRateId: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const db = createAdminClient();

  const updates: Array<{ key: string; value: string }> = [];

  for (const [bodyKey, settingKey] of [
    ["defaultItemId", "qbo_item_id_default"],
    ["membershipItemId", "qbo_item_id_membership"],
    ["partnershipItemId", "qbo_item_id_partnership"],
    ["conferencePartialRefundItemId", "qbo_item_id_conference_partial_refund"],
    ["stripeDepositAccountId", "qbo_stripe_deposit_account_id"],
    ["outsideCanadaTaxCode", "qbo_tax_code_outside_canada"],
    ["publicTicketTaxCode", "qbo_tax_code_public_ticket"],
    ["stripeTaxRateIdOutsideCanada", "stripe_tax_rate_id_outside_canada"],
  ] as const) {
    if (typeof body[bodyKey] === "string" || body[bodyKey] === null) {
      updates.push({ key: settingKey, value: body[bodyKey] ?? "" });
    }
  }

  if (Array.isArray(body.priceBands)) {
    const bands = (body.priceBands as PriceBandInput[])
      .filter((b) => b && typeof b.itemId === "string" && b.itemId && Number.isFinite(b.maxAmount) && b.maxAmount > 0)
      .map((b) => ({ maxAmountCents: Math.round(b.maxAmount * 100), itemId: b.itemId as string }))
      .sort((a, b) => a.maxAmountCents - b.maxAmountCents);
    updates.push({ key: "qbo_membership_price_bands", value: JSON.stringify(bands) });
  }

  if (Array.isArray(body.membershipTaxCodes)) {
    const taxCodes = (body.membershipTaxCodes as MembershipTaxCodeInput[])
      .filter((m) => m && typeof m.province === "string" && m.province && typeof m.taxCodeId === "string" && m.taxCodeId)
      .map((m) => ({ province: m.province, taxCodeId: m.taxCodeId as string }));
    updates.push({ key: "qbo_membership_tax_codes", value: JSON.stringify(taxCodes) });
  }

  if (Array.isArray(body.stripeMembershipTaxRateIds)) {
    const taxRates = (body.stripeMembershipTaxRateIds as StripeMembershipTaxRateInput[])
      .filter(
        (m) =>
          m &&
          typeof m.province === "string" &&
          m.province &&
          typeof m.stripeTaxRateId === "string" &&
          m.stripeTaxRateId
      )
      .map((m) => ({ province: m.province, stripeTaxRateId: m.stripeTaxRateId as string }));
    updates.push({ key: "stripe_membership_tax_rate_ids", value: JSON.stringify(taxRates) });
  }

  for (const { key, value } of updates) {
    await db
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }

  return NextResponse.json({ ok: true, updated: updates.map((u) => u.key) });
}
