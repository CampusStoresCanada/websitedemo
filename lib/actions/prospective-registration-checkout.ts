"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { getRequiredLegalDocumentsPublic } from "@/lib/actions/conference-legal";

/**
 * "Pay first, no application" for a non-member buying a Day Pass — there is
 * deliberately no requireAuthenticated() here, since there is no user or
 * organization yet. Unlike the booth-prospect flow (which routes into the
 * partner-application pipeline for board approval), a day pass isn't joining
 * CSC — the webhook mints access immediately once Stripe confirms payment.
 */

const NON_MEMBER_AUDIENCE_ENTITY_ID = "a9581ad9-5e15-4cc8-a53c-178fcf5ce910";
const NON_MEMBER_SOURCE_ROLE = "non_member";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function createProspectiveRegistrationCheckout(params: {
  conferenceId: string;
  offerEntityId: string;
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  dietaryRestrictions: string;
  acceptedDocumentTypes: string[];
  successUrl: string;
  cancelUrl: string;
}): Promise<Result<{ checkoutUrl: string }>> {
  const organizationName = params.organizationName.trim();
  const firstName = params.firstName.trim();
  const lastName = params.lastName.trim();
  const email = params.email.trim().toLowerCase();
  const phone = params.phone.trim();
  const jobTitle = params.jobTitle.trim();
  const dietaryRestrictions = params.dietaryRestrictions.trim();

  if (!organizationName) return { success: false, error: "Organization name is required." };
  if (!firstName || !lastName) return { success: false, error: "First and last name are required." };
  if (!email || !email.includes("@")) return { success: false, error: "A valid email is required." };

  const db = createAdminClient();

  const { data: offer } = await db
    .from("conference_entities")
    .select("id, name, kind, is_for_sale, price_cents, tier_prices")
    .eq("id", params.offerEntityId)
    .eq("conference_id", params.conferenceId)
    .maybeSingle();

  if (!offer || offer.kind !== "registration" || !offer.is_for_sale) {
    return { success: false, error: "That registration isn't available." };
  }

  // This flow is scoped to non-members only — confirm the offer is actually
  // gated to that audience, rather than trusting the caller's choice of id.
  const { data: whoRefs } = await db
    .from("conference_entity_refs")
    .select("to_entity_id")
    .eq("from_entity_id", offer.id)
    .eq("role", "who");
  const isNonMemberEligible = (whoRefs ?? []).some((r) => r.to_entity_id === NON_MEMBER_AUDIENCE_ENTITY_ID);
  if (!isNonMemberEligible) {
    return { success: false, error: "That registration isn't available to non-members." };
  }

  // Re-derive which documents must be accepted server-side — never trust a
  // client-supplied list for a consent gate.
  const legalResult = await getRequiredLegalDocumentsPublic(params.conferenceId, [NON_MEMBER_SOURCE_ROLE]);
  const requiredDocumentTypes = legalResult.success ? (legalResult.data ?? []).map((d) => d.document_type) : [];
  const missing = requiredDocumentTypes.filter((t) => !params.acceptedDocumentTypes.includes(t));
  if (missing.length > 0) {
    return { success: false, error: "Please accept all required documents before continuing." };
  }

  const tierPrices = (offer.tier_prices as Record<string, number> | null) ?? {};
  const priceCents = typeof tierPrices[NON_MEMBER_SOURCE_ROLE] === "number"
    ? tierPrices[NON_MEMBER_SOURCE_ROLE]
    : offer.price_cents ?? 0;

  // A day pass is a conference supply — destination-based, taxed where the
  // conference is held, at the same flat rate every booth and registration
  // uses. This line carried no tax_rates at all until 2026-08-17, so the
  // buyer paid nothing while the QuickBooks receipt booked the tax anyway.
  // Refuse rather than silently under-collect (same rule as the booth path).
  const { data: conference } = await db
    .from("conference_instances")
    .select("stripe_tax_rate_id")
    .eq("id", params.conferenceId)
    .maybeSingle();

  if (!conference?.stripe_tax_rate_id) {
    return {
      success: false,
      error: "This conference has no Stripe tax rate configured — set it on the conference's Tax fieldset before selling registrations.",
    };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: priceCents,
          product_data: { name: offer.name },
        },
        tax_rates: [conference.stripe_tax_rate_id],
      },
    ],
    custom_text: {
      submit: {
        message: "This confirms your day pass — you'll get a confirmation email once payment completes.",
      },
    },
    metadata: {
      checkout_kind: "prospective_registration",
      conference_id: params.conferenceId,
      offer_entity_id: params.offerEntityId,
      email,
    },
  });

  if (!session.url) {
    return { success: false, error: "Failed to start checkout." };
  }

  const { error: insertError } = await db.from("prospective_registration_payments").insert({
    email,
    first_name: firstName,
    last_name: lastName,
    organization_name: organizationName,
    job_title: jobTitle || null,
    phone: phone || null,
    dietary_restrictions: dietaryRestrictions || null,
    conference_id: params.conferenceId,
    offer_entity_id: params.offerEntityId,
    amount_cents: priceCents,
    stripe_checkout_session_id: session.id,
    accepted_document_types: params.acceptedDocumentTypes,
    status: "pending",
  });
  if (insertError) return { success: false, error: insertError.message };

  return { success: true, data: { checkoutUrl: session.url } };
}
