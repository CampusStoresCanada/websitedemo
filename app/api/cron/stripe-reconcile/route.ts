import { NextRequest, NextResponse } from "next/server";
import { findUntrackedStripeInvoices, stripeInboundReconcileRun } from "@/lib/stripe/reconcile";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily catch-up for Stripe notices that never arrived. Asks Stripe for the
 * real status of every invoice still open here and settles the ones Stripe
 * says are paid or void, through the same path a delivered webhook takes.
 *
 * Until 2026-11-17 this only ran from the button on /admin/ops. Hotline
 * Apparel paid $9,040 on 2026-08-11, the notice was never recorded, and the
 * invoice read unpaid for three months because nobody pressed it.
 *
 * Runs before the renewal charge and grace check, so an org that has paid is
 * settled before either looks at it.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await stripeInboundReconcileRun();
    if (result.errors.length > 0) {
      await raiseAlertIfNotOpen({
        ruleKey: "stripe_reconcile_failed",
        severity: "warning",
        message:
          `The daily Stripe catch-up could not check ${result.errors.length} invoice` +
          `${result.errors.length === 1 ? "" : "s"}. A payment made in Stripe may not show here.`,
        details: { errors: result.errors.slice(0, 20) },
      });
    }

    // One alert per invoice made in the Stripe dashboard. Resolving it is how
    // staff say "entered in QuickBooks by hand"; nothing raises it again.
    let untracked: Awaited<ReturnType<typeof findUntrackedStripeInvoices>> = [];
    try {
      untracked = await findUntrackedStripeInvoices();
      for (const inv of untracked) {
        const dollars = (inv.totalCents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
        await raiseAlertIfNotOpen({
          ruleKey: `stripe_invoice_untracked:${inv.stripeInvoiceId}`,
          severity: "warning",
          message:
            `${inv.customer ?? "A customer"} has a ${inv.status} Stripe invoice for ${dollars}` +
            `${inv.number ? ` (${inv.number})` : ""} that was made in the Stripe dashboard. ` +
            `The site has no record of it, so it will not reach QuickBooks on its own. ` +
            `Enter it in QuickBooks by hand, then resolve this alert.`,
          details: { ...inv },
        });
      }
    } catch (err) {
      console.error("[cron/stripe-reconcile] untracked sweep failed:", err);
    }

    return NextResponse.json({ ...result, untracked: untracked.length });
  } catch (error) {
    console.error("[cron/stripe-reconcile] Unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
