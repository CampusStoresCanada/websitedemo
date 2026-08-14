#!/usr/bin/env node

// One-off backfill for invoices created before invoice_pdf_url/
// hosted_invoice_url existed locally. Going forward these are captured for
// free at finalize time and on invoice.paid (lib/stripe/billing.ts,
// lib/stripe/webhook-processing.ts) — this script only needs to run once
// for historical rows. Read-only against Stripe (invoices.retrieve), writes
// only to our own invoices table.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const isTestMode = process.env.STRIPE_TEST_MODE === "true";
const stripeSecretKey = isTestMode ? process.env.STRIPE_SECRET_TEST : process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error(isTestMode ? "Missing STRIPE_SECRET_TEST" : "Missing STRIPE_SECRET_KEY");
  process.exit(1);
}
if (isTestMode) {
  console.warn("[backfill] TEST MODE — using sk_test_ keys.");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const stripe = new Stripe(stripeSecretKey);

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const { data: rows, error } = await db
    .from("invoices")
    .select("id, stripe_invoice_id")
    .not("stripe_invoice_id", "is", null)
    .is("invoice_pdf_url", null);

  if (error) {
    console.error("Failed to load invoices:", error.message);
    process.exit(1);
  }

  console.log(`${rows.length} invoice(s) need backfilling.${DRY_RUN ? " (dry run — no writes)" : ""}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const stripeInvoice = await stripe.invoices.retrieve(row.stripe_invoice_id);

      if (!stripeInvoice.invoice_pdf && !stripeInvoice.hosted_invoice_url) {
        // Still draft in Stripe — nothing to capture yet, not an error.
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        const { error: updateError } = await db
          .from("invoices")
          .update({
            invoice_pdf_url: stripeInvoice.invoice_pdf ?? null,
            hosted_invoice_url: stripeInvoice.hosted_invoice_url ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (updateError) throw new Error(updateError.message);
      }

      updated++;
    } catch (err) {
      failed++;
      console.error(`  [${row.id}] stripe_invoice_id=${row.stripe_invoice_id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`Done. Updated ${updated}, skipped (still draft) ${skipped}, failed ${failed}.`);
  if (failed > 0) process.exitCode = 1;
}

main();
