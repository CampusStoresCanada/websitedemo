import Stripe from "stripe";

// STRIPE_TEST_MODE opts into the test-key pair for local verification —
// absent (the default everywhere else, including production) it behaves
// exactly as before, on the live keys. Never flip the default the other way;
// a missing env var should never silently start taking real payments through
// as "test."
const isTestMode = process.env.STRIPE_TEST_MODE === "true";
const secretKey = isTestMode ? process.env.STRIPE_SECRET_TEST : process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error(isTestMode ? "STRIPE_SECRET_TEST is not set" : "STRIPE_SECRET_KEY is not set");
}

if (isTestMode) {
  console.warn("[stripe] TEST MODE — using sk_test_ keys, no real charges will be made.");
}

export const stripe = new Stripe(secretKey, {
  // Pin to a specific API version for stability
  apiVersion: "2026-02-25.clover",
  typescript: true,
});
