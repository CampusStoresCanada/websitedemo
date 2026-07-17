import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Registration confirmed" };

/**
 * Deliberately public. Trusts the Stripe redirect optimistically rather than
 * blocking on webhook confirmation, same as /exhibit/success — the webhook
 * can lag the redirect by a few seconds and there's nothing sensitive to gate
 * here (the payment already succeeded on Stripe's side by page load).
 */
export default async function AttendSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  if (!sessionId) notFound();

  const db = createAdminClient();
  const { data: payment } = await db
    .from("prospective_registration_payments")
    .select("id, first_name, organization_name, offer:conference_entities!prospective_registration_payments_offer_entity_id_fkey(name)")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (!payment) notFound();

  const offerName = (Array.isArray(payment.offer) ? payment.offer[0] : payment.offer)?.name ?? "your day pass";

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-gray-900">You&apos;re registered</h1>
      <p className="mt-3 text-gray-600">
        Thanks, {payment.first_name} — {offerName} is confirmed for {payment.organization_name}.
      </p>
      <p className="mt-3 text-sm text-gray-600">
        A confirmation email is on its way. We look forward to seeing you at the conference.
      </p>
    </main>
  );
}
