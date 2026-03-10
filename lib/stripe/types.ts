// Stripe Billing Types — Chunk 04

export type InvoiceType =
  | "membership"
  | "partnership"
  | "conference"
  | "addon"
  | "sponsorship";

export type InvoiceStatus =
  | "draft"
  | "invoiced"
  | "pending_settlement"
  | "paid"
  | "failed"
  | "overdue"
  | "refunded_full"
  | "refunded_partial"
  | "voided";

export type PaymentSource = "stripe" | "quickbooks" | "manual";

export interface Invoice {
  id: string;
  organization_id: string;
  type: InvoiceType;
  description: string;
  amount_cents: number;
  currency: string;
  tax_amount_cents: number;
  total_cents: number;
  proration_discount_pct: number;
  original_amount_cents: number | null;
  status: InvoiceStatus;
  payment_source: PaymentSource | null;
  external_payment_id: string | null;
  paid_out_of_band_at: string | null;
  reminder_suppressed_at: string | null;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_customer_id: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  due_date: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  refund_amount_cents: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

export interface PaymentMethod {
  id: string;
  organization_id: string;
  stripe_payment_method_id: string;
  stripe_customer_id: string;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProrationResult {
  amountCents: number;
  discountPct: number;
}

/** Membership tier from policy billing.membership_tiers */
export interface MembershipTier {
  max_fte: number | null;
  price: number;
}

/** Proration rule from policy billing.proration_rules */
export interface ProrationRule {
  after_month_day: string; // "MM-DD"
  discount_pct: number;
}
