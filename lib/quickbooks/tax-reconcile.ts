// Tax reconciliation — the safety net for the whole GST/HST money path.
//
// Every tax bug this system has had shared a shape: some code applied ONE tax
// treatment to a sale that contained two (conference supplies are taxed where
// the conference is held, membership dues where the buyer is), and nobody
// noticed until a customer's receipt looked wrong. Some of those bugs were
// consistent across our own tables AND QuickBooks — the cart stored 13% on a
// BC partner's dues and QBO faithfully booked the same 13% — so simply
// comparing our database to QuickBooks would have found nothing.
//
// This therefore recomputes what the tax SHOULD be from first principles, per
// line, from the authoritative rate sources, and compares that independent
// figure against all three places a number can be wrong:
//
//   charged  — what we billed (conference_orders.tax_cents, or Stripe's own
//              computed tax on a prospective-booth checkout)
//   booked   — what the QuickBooks Sales Receipt actually posted
//   expected — recomputed here
//
// Any disagreement raises an ops alert. Read-only: it never edits QuickBooks
// or our own rows, because the right correction depends on whether money
// actually moved and that's a human call.

import { createAdminClient } from "@/lib/supabase/admin";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { stripe } from "@/lib/stripe/client";
import { getQBSalesReceipt } from "./client";
import { resolveProspectiveDuesProvince } from "./conference-export";
import { resolveConferenceOrderTaxRates, resolveMembershipTaxRatePct } from "@/lib/stripe/tax";

const MEMBERSHIP_RENEWAL_KIND = "membership_renewal";

/** Cent-level rounding differs legitimately between Stripe, QBO and us on
 * multi-line orders; anything at or under this is noise, not a bug. */
const TOLERANCE_CENTS = 2;

export interface TaxDiscrepancy {
  source: "conference_order" | "prospective_booth" | "prospective_registration" | "event_ticket";
  reference: string;
  qboDocId: string | null;
  subject: string;
  expectedTaxCents: number;
  chargedTaxCents: number | null;
  bookedTaxCents: number | null;
  summary: string;
}

export interface TaxReconciliationResult {
  checked: number;
  discrepancies: TaxDiscrepancy[];
  /** Discrepancies that are real but previously reviewed and accepted — still
   * reported here so they stay visible, but they raise no alert. */
  acknowledged: TaxDiscrepancy[];
  skipped: string[];
}

type ExceptionKey = string;
const exceptionKey = (source: string, reference: string): ExceptionKey => `${source}:${reference}`;

interface AcknowledgedException {
  expectedTaxCents: number;
  chargedTaxCents: number | null;
  bookedTaxCents: number | null;
  reason: string;
}

async function loadExceptions(
  db: ReturnType<typeof createAdminClient>
): Promise<Map<ExceptionKey, AcknowledgedException>> {
  const { data } = await db
    .from("tax_reconciliation_exceptions")
    .select("source, reference, expected_tax_cents, charged_tax_cents, booked_tax_cents, reason");

  return new Map(
    (data ?? []).map((row) => [
      exceptionKey(row.source, row.reference),
      {
        expectedTaxCents: row.expected_tax_cents,
        chargedTaxCents: row.charged_tax_cents,
        bookedTaxCents: row.booked_tax_cents,
        reason: row.reason,
      },
    ])
  );
}

/**
 * An acceptance covers the discrepancy as it was reviewed, not the sale
 * forever — every figure must still match. A sale whose numbers have since
 * moved is a new finding and surfaces again.
 */
function isAcknowledged(
  exception: AcknowledgedException | undefined,
  found: TaxDiscrepancy
): boolean {
  if (!exception) return false;
  return (
    exception.expectedTaxCents === found.expectedTaxCents &&
    exception.chargedTaxCents === found.chargedTaxCents &&
    exception.bookedTaxCents === found.bookedTaxCents
  );
}

const bad = (expected: number, actual: number | null) =>
  actual !== null && Math.abs(expected - actual) > TOLERANCE_CENTS;

const d = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);

/**
 * Recompute a conference order's correct tax line by line, then compare it to
 * what we charged and what QuickBooks posted.
 */
async function reconcileConferenceOrders(
  db: ReturnType<typeof createAdminClient>,
  sinceIso: string,
  result: TaxReconciliationResult
): Promise<void> {
  const { data: rows, error } = await db
    .from("qbo_conference_receipt_queue")
    .select("conference_order_id, qbo_sales_receipt_id, conference_orders!inner(organization_id, conference_id, subtotal_cents, tax_cents, status, stripe_payment_intent_id)")
    .eq("status", "completed")
    .gte("processed_at", sinceIso);

  if (error) throw new Error(`Failed to load conference receipt queue: ${error.message}`);

  for (const row of rows ?? []) {
    const order = row.conference_orders;
    result.checked++;

    let rates: { conferenceRatePct: number; membershipRatePct: number };
    try {
      rates = await resolveConferenceOrderTaxRates(db, {
        conferenceId: order.conference_id,
        organizationId: order.organization_id,
      });
    } catch (err) {
      // A missing province is itself worth surfacing, but as a skip rather
      // than a tax mismatch — we genuinely cannot compute an expected figure.
      result.skipped.push(`order ${row.conference_order_id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const { data: items } = await db
      .from("conference_order_items")
      .select("quantity, unit_price_cents, tax_cents, offer:conference_entities!conference_order_items_offer_entity_id_fkey(kind)")
      .eq("order_id", row.conference_order_id);

    if (!items || items.length === 0) {
      result.skipped.push(`order ${row.conference_order_id}: no line items`);
      continue;
    }

    let expectedTaxCents = 0;
    for (const item of items) {
      const offer = Array.isArray(item.offer) ? item.offer[0] : item.offer;
      const ratePct =
        offer?.kind === MEMBERSHIP_RENEWAL_KIND ? rates.membershipRatePct : rates.conferenceRatePct;
      expectedTaxCents += Math.round(item.quantity * item.unit_price_cents * (ratePct / 100));
    }

    // "Charged" must mean what Stripe actually took, not what our own row says
    // it took — otherwise the check can't see the case where the order RPC and
    // the checkout session disagree about a line's rate, which is precisely
    // how a customer ends up billed a total the order doesn't record. Falls
    // back to our row only when the payment intent can't be read.
    let chargedTaxCents = order.tax_cents;
    if (order.stripe_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, {
          expand: ["latest_charge"],
        });
        const charge = pi.latest_charge as { amount_refunded?: number } | null;
        const refundedCents = charge?.amount_refunded ?? 0;
        // Only meaningful on a fully-intact payment. Once anything has been
        // refunded, the amount left on the charge no longer decomposes into
        // "this subtotal plus its tax" — part of the goods went back, and
        // working out the remaining tax position needs the refund receipt,
        // which this check doesn't model. Deriving anyway produced a nonsense
        // negative on a partially-refunded order.
        if (refundedCents === 0 && (pi.amount_received ?? 0) > 0) {
          chargedTaxCents = (pi.amount_received ?? 0) - order.subtotal_cents;
        }
      } catch {
        // Unreadable payment intent — keep our own figure rather than skipping.
      }
    }

    let bookedTaxCents: number | null = null;
    if (row.qbo_sales_receipt_id) {
      const receipt = await getQBSalesReceipt(row.qbo_sales_receipt_id);
      if (receipt) bookedTaxCents = Math.round((receipt.TxnTaxDetail?.TotalTax ?? 0) * 100);
    }

    // A refunded order's QBO position is the receipt net of its refund
    // receipt, which this single-document check can't see — skip rather than
    // report a mismatch we can't substantiate.
    const refunded = order.status !== "paid";
    if (bad(expectedTaxCents, chargedTaxCents) || (!refunded && bad(expectedTaxCents, bookedTaxCents))) {
      const { data: org } = await db
        .from("organizations")
        .select("name")
        .eq("id", order.organization_id)
        .maybeSingle();

      result.discrepancies.push({
        source: "conference_order",
        reference: row.conference_order_id,
        qboDocId: row.qbo_sales_receipt_id,
        subject: org?.name ?? order.organization_id,
        expectedTaxCents,
        chargedTaxCents,
        bookedTaxCents,
        summary:
          `expected ${d(expectedTaxCents)} tax ` +
          `(conference ${rates.conferenceRatePct}%, dues ${rates.membershipRatePct}%), ` +
          `charged ${d(chargedTaxCents)}, QuickBooks booked ${d(bookedTaxCents)}`,
      });
    }
  }
}

/**
 * The prospective-booth checkout is the one place Stripe computes the tax
 * itself (per-line tax_rates) rather than us handing it a total, so here the
 * "charged" figure has to come from Stripe rather than our own row.
 */
async function reconcileProspectiveBooths(
  db: ReturnType<typeof createAdminClient>,
  sinceIso: string,
  result: TaxReconciliationResult
): Promise<void> {
  const { data: rows, error } = await db
    .from("qbo_misc_receipt_queue")
    .select("payment_id, qbo_sales_receipt_id")
    .eq("status", "completed")
    .eq("payment_kind", "prospective_booth")
    .gte("processed_at", sinceIso);

  if (error) throw new Error(`Failed to load misc receipt queue: ${error.message}`);

  for (const row of rows ?? []) {
    result.checked++;

    const { data: payment } = await db
      .from("prospective_booth_payments")
      .select("company_name, province, linked_application_id, conference_id, booth_amount_cents, membership_amount_cents, stripe_checkout_session_id")
      .eq("id", row.payment_id)
      .maybeSingle();

    if (!payment) {
      result.skipped.push(`prospective booth ${row.payment_id}: payment row missing`);
      continue;
    }

    const { data: conference } = await db
      .from("conference_instances")
      .select("tax_rate_pct")
      .eq("id", payment.conference_id)
      .maybeSingle();

    let duesRatePct: number;
    try {
      // Must use the SAME province the QBO exporter used, or this check
      // "finds" a mismatch that is really just the two of us disagreeing —
      // the linked org's address wins over the province typed at checkout.
      const duesOrg = await resolveProspectiveDuesProvince(db, payment);
      if (!duesOrg.province) throw new Error("no province on the payment or its linked org");
      duesRatePct = await resolveMembershipTaxRatePct(db, duesOrg.province);
    } catch (err) {
      result.skipped.push(`prospective booth ${row.payment_id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const conferenceRatePct = Number(conference?.tax_rate_pct ?? 0);
    const expectedTaxCents =
      Math.round(payment.booth_amount_cents * (conferenceRatePct / 100)) +
      Math.round(payment.membership_amount_cents * (duesRatePct / 100));

    let chargedTaxCents: number | null = null;
    try {
      const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
      chargedTaxCents = session.total_details?.amount_tax ?? null;
    } catch {
      // Stripe unreachable for this session — still worth checking QBO.
    }

    let bookedTaxCents: number | null = null;
    if (row.qbo_sales_receipt_id) {
      const receipt = await getQBSalesReceipt(row.qbo_sales_receipt_id);
      if (receipt) bookedTaxCents = Math.round((receipt.TxnTaxDetail?.TotalTax ?? 0) * 100);
    }

    if (bad(expectedTaxCents, chargedTaxCents) || bad(expectedTaxCents, bookedTaxCents)) {
      result.discrepancies.push({
        source: "prospective_booth",
        reference: row.payment_id,
        qboDocId: row.qbo_sales_receipt_id,
        subject: payment.company_name,
        expectedTaxCents,
        chargedTaxCents,
        bookedTaxCents,
        summary:
          `expected ${d(expectedTaxCents)} tax ` +
          `(booth ${conferenceRatePct}%, dues ${duesRatePct}%), ` +
          `Stripe collected ${d(chargedTaxCents)}, QuickBooks booked ${d(bookedTaxCents)}`,
      });
    }
  }
}

/**
 * The two remaining misc-receipt kinds are single-supply, so there's no
 * per-line split to verify — but they still need the charged-vs-booked
 * comparison, because both went live carrying no Stripe tax at all while
 * their QuickBooks receipts booked it. Expected is taken from the QBO
 * receipt's own tax, so this specifically answers "did Stripe collect what
 * QuickBooks says we collected".
 */
async function reconcileSingleSupplyMiscReceipts(
  db: ReturnType<typeof createAdminClient>,
  sinceIso: string,
  result: TaxReconciliationResult
): Promise<void> {
  const { data: rows, error } = await db
    .from("qbo_misc_receipt_queue")
    .select("payment_id, payment_kind, qbo_sales_receipt_id")
    .eq("status", "completed")
    .in("payment_kind", ["prospective_registration", "event_ticket"])
    .gte("processed_at", sinceIso);

  if (error) throw new Error(`Failed to load misc receipt queue: ${error.message}`);

  for (const row of rows ?? []) {
    result.checked++;

    let sessionId: string | null = null;
    let subject = row.payment_id;

    if (row.payment_kind === "prospective_registration") {
      const { data: payment } = await db
        .from("prospective_registration_payments")
        .select("organization_name, stripe_checkout_session_id")
        .eq("id", row.payment_id)
        .maybeSingle();
      sessionId = payment?.stripe_checkout_session_id ?? null;
      subject = payment?.organization_name ?? subject;
    } else {
      const { data: registration } = await db
        .from("event_registrations")
        .select("stripe_session_id, event:events(title)")
        .eq("id", row.payment_id)
        .maybeSingle();
      sessionId = registration?.stripe_session_id ?? null;
      const event = Array.isArray(registration?.event) ? registration?.event[0] : registration?.event;
      subject = event?.title ?? subject;
    }

    let bookedTaxCents: number | null = null;
    if (row.qbo_sales_receipt_id) {
      const receipt = await getQBSalesReceipt(row.qbo_sales_receipt_id);
      if (receipt) bookedTaxCents = Math.round((receipt.TxnTaxDetail?.TotalTax ?? 0) * 100);
    }
    if (bookedTaxCents === null) {
      result.skipped.push(`${row.payment_kind} ${row.payment_id}: QBO receipt unreadable`);
      continue;
    }

    let chargedTaxCents: number | null = null;
    if (sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        chargedTaxCents = session.total_details?.amount_tax ?? null;
      } catch {
        // Session unreadable — leave null, which reports as "—" rather than 0.
      }
    }

    if (bad(bookedTaxCents, chargedTaxCents)) {
      result.discrepancies.push({
        source: row.payment_kind as TaxDiscrepancy["source"],
        reference: row.payment_id,
        qboDocId: row.qbo_sales_receipt_id,
        subject,
        expectedTaxCents: bookedTaxCents,
        chargedTaxCents,
        bookedTaxCents,
        summary: `Stripe collected ${d(chargedTaxCents)} tax, QuickBooks booked ${d(bookedTaxCents)}`,
      });
    }
  }
}

export async function quickbooksTaxReconciliationRun(
  options: { sinceDays?: number } = {}
): Promise<TaxReconciliationResult> {
  const db = createAdminClient();
  const sinceIso = new Date(Date.now() - (options.sinceDays ?? 120) * 86_400_000).toISOString();

  const result: TaxReconciliationResult = { checked: 0, discrepancies: [], acknowledged: [], skipped: [] };

  await reconcileConferenceOrders(db, sinceIso, result);
  await reconcileProspectiveBooths(db, sinceIso, result);
  await reconcileSingleSupplyMiscReceipts(db, sinceIso, result);

  // Split off the ones a human has already reviewed and accepted. They stay in
  // the returned report — visible to anyone reading it — but raise no alert,
  // so the genuinely new findings aren't buried under permanent known ones.
  const exceptions = await loadExceptions(db);
  const stillOpen: TaxDiscrepancy[] = [];
  for (const discrepancy of result.discrepancies) {
    if (isAcknowledged(exceptions.get(exceptionKey(discrepancy.source, discrepancy.reference)), discrepancy)) {
      result.acknowledged.push(discrepancy);
    } else {
      stillOpen.push(discrepancy);
    }
  }
  result.discrepancies = stillOpen;

  // One alert per affected sale, keyed by its reference so a persistent
  // discrepancy doesn't re-alert every run until someone fixes it.
  for (const discrepancy of result.discrepancies) {
    await raiseAlertIfNotOpen({
      ruleKey: `qbo_tax_mismatch:${discrepancy.source}:${discrepancy.reference}`,
      severity: "critical",
      message: `Tax mismatch on ${discrepancy.subject}: ${discrepancy.summary}`,
      details: { ...discrepancy },
    });
  }

  if (result.skipped.length > 0) {
    console.warn("[qbo] tax reconciliation skipped:", result.skipped);
  }

  return result;
}
