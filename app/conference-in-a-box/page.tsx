import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { SALES_OPEN_STATUSES } from "@/lib/constants/conference";
import { formatCents } from "@/lib/utils";
import ExhibitCheckoutForm from "../conference/[year]/[edition]/exhibit/exhibit-checkout-form";

/**
 * Conference in a Box — a product page, not a conference sub-page.
 *
 * It sells to any CSC partner whether or not they exhibit, whether or not they
 * registered, and (through the pay-first path below) whether or not they are a
 * partner yet. A `/conference/<year>/<edition>/…` URL would tell most of that
 * audience they are looking at part of an event they have not signed up for,
 * and would carry a meaningless edition code into an email a reader forwards to
 * a colleague. So it sits at the root beside /partnership and /membership, and
 * resolves which conference is currently selling rather than being told.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Conference in a Box",
  description:
    "Put one of your products into every CSC member store before the Campus Store Conference.",
};

const OFFER_NAME = "Conference in a Box";

export default async function ConferenceInABoxPage() {
  const db = createAdminClient();

  // Which conference is selling right now — the same resolution app/org/[slug]
  // uses as its fallback for exactly this product, so there is one answer to
  // "what is on sale" rather than a second one living here.
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, year, edition_code, end_date, status")
    .in("status", SALES_OPEN_STATUSES as unknown as string[])
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!conference) notFound();

  const { data: offer } = await db
    .from("conference_entities")
    .select("id, name, price_cents, is_for_sale, attributes")
    .eq("conference_id", conference.id)
    .eq("name", OFFER_NAME)
    .maybeSingle();

  if (!offer || !offer.is_for_sale) notFound();

  const attrs = (offer.attributes as Record<string, unknown> | null) ?? {};
  const about = typeof attrs.about === "string" ? attrs.about : null;
  const rules = typeof attrs.rules === "string" ? attrs.rules : null;
  const deadlines = Array.isArray(attrs.deadlines)
    ? (attrs.deadlines as Array<{ date?: string; label?: string; consequence?: string }>)
    : [];

  // Signed in with an org? Send them to the catalogue with this offer named,
  // where addOfferToCart already attaches a membership renewal if theirs does
  // not cover the conference. Signed out, there is no user and no org to write
  // a cart row against, so the pay-first path takes the purchase and the
  // partnership in one Stripe session instead.
  const auth = await getOptionalAuthContext();
  const signedInWithOrg = Boolean(auth && auth.activeOrgIds.length > 0);
  const offersHref = `/conference/${conference.year}/${conference.edition_code}/offers?offer=${offer.id}#offer-${offer.id}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#EE2A2E]">
        Campus Store Conference {conference.year}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#1A1A1A]">{offer.name}</h1>
      <p className="mt-1 text-lg font-semibold text-gray-900">{formatCents(offer.price_cents ?? 0)}</p>

      {about ? <p className="mt-6 text-base leading-relaxed text-gray-700">{about}</p> : null}

      {deadlines.length > 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          {deadlines.map((d, i) => (
            <p key={i} className="text-sm text-amber-900">
              <strong>{d.date}</strong>
              {d.label ? ` — ${d.label}.` : null}
              {d.consequence ? ` ${d.consequence}` : null}
            </p>
          ))}
        </div>
      ) : null}

      {rules ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">What to send</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{rules}</p>
        </section>
      ) : null}

      <section className="mt-10">
        {signedInWithOrg ? (
          <>
            <Link
              href={offersHref}
              className="inline-block rounded-md bg-[#EE2A2E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#b50001]"
            >
              Add it to your cart
            </Link>
            <p className="mt-2 text-xs text-gray-500">
              Already included with a Connected Exhibitor booth — if that is you, there is
              nothing to buy, only something to send.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900">Buy one</h2>
            <p className="mt-1 text-sm text-gray-600">
              Already a CSC partner?{" "}
              <Link
                href={`/login?next=${encodeURIComponent(offersHref)}`}
                className="font-medium text-[#EE2A2E] hover:underline"
              >
                Sign in
              </Link>{" "}
              and it goes straight to your cart. Not a partner yet? Buy it here — your
              partnership is charged in the same checkout.
            </p>
            <ExhibitCheckoutForm
              conferenceId={conference.id}
              conferenceYear={conference.year}
              conferenceEdition={conference.edition_code}
              booths={[{ id: offer.id, name: offer.name, priceCents: offer.price_cents ?? 0 }]}
              label="What you're buying"
              namePrefix=""
              successUrl={`/conference/${conference.year}/${conference.edition_code}/exhibit/success?session_id={CHECKOUT_SESSION_ID}`}
              cancelUrl="/conference-in-a-box"
              footnote="Your card is charged for Conference in a Box plus CSC partnership dues. This does not guarantee approval — the CSC board reviews every new partner application after payment."
            />
          </>
        )}
      </section>
    </main>
  );
}
