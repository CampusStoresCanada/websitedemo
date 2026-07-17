import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Payment received" };

/**
 * Deliberately public. Trusts the Stripe redirect optimistically rather than
 * blocking on webhook confirmation — the webhook can lag behind the redirect
 * by a few seconds, and there's nothing sensitive to gate here (the payment
 * itself already succeeded on Stripe's side by the time this page loads).
 */
export default async function ExhibitSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  if (!sessionId) notFound();

  const db = createAdminClient();
  const { data: payment } = await db
    .from("prospective_booth_payments")
    .select("id, company_name, email, amount_cents, booth:conference_entities!prospective_booth_payments_booth_entity_id_fkey(name)")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (!payment) notFound();

  const boothName = (Array.isArray(payment.booth) ? payment.booth[0] : payment.booth)?.name ?? "";
  const applyHref = `/apply/partner?paymentId=${payment.id}&companyName=${encodeURIComponent(payment.company_name)}&email=${encodeURIComponent(payment.email)}`;

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-gray-900">Payment received</h1>
      <p className="mt-3 text-gray-600">
        Thanks, {payment.company_name} — booth {boothName} is reserved and your
        membership deposit is paid.
      </p>
      <p className="mt-3 text-sm text-gray-600">
        This is not final yet. The CSC board still needs to review and approve your
        partnership application. Finish the short application below so they have what
        they need — we&apos;ll email you once it&apos;s reviewed.
      </p>
      <Link
        href={applyHref}
        className="mt-6 inline-block rounded-md bg-[#EE2A2E] px-6 py-3 text-sm font-medium text-white hover:bg-[#b50001]"
      >
        Finish your application
      </Link>
    </main>
  );
}
