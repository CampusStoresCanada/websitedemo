import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalAuthContext, isGlobalAdmin } from "@/lib/auth/guards";
import { SALES_OPEN_STATUSES } from "@/lib/constants/conference";
import { formatCents } from "@/lib/utils";
import { listConferenceOffers } from "@/lib/actions/conference-entities";
import OfferCard from "@/components/conference/OfferCard";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import PrintButton from "@/components/benchmarking/PrintButton";
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

/**
 * "Friday, November 20, 2026", not "2026-11-20".
 *
 * Parsed as UTC noon rather than `new Date("2026-11-20")`, which is midnight
 * UTC and renders as the 19th for every reader west of Greenwich — i.e. every
 * Canadian partner this page is written for.
 */
function formatDeadline(date: string | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function ConferenceInABoxPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const query = await searchParams;
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
  // Read from the entity, not written into this page: the announcement email
  // quotes the same address, and two copies of a shipping address is how a
  // pallet ends up at the wrong loading dock.
  const shipTo = (attrs.ship_to ?? null) as {
    attention?: string;
    marking?: string;
    company?: string;
    lines?: string[];
    city_line?: string;
  } | null;

  // Signed in with an org? The add-to-cart control goes HERE. Sending them to
  // the catalogue to press the same button there is a click that buys nothing
  // — and `OfferCard` already IS that control, with the price for this org's
  // tier, the eligibility reason when it can't be bought, and the cart-badge
  // event on success. Rendering it is reuse; a second button would be a second
  // answer to "how do I buy this".
  //
  // addOfferToCart attaches a membership renewal in the same cart when the
  // org's membership doesn't cover the conference, so an unrenewed partner is
  // handled without leaving this page either.
  //
  // Signed out there is no user and no org to write a cart row against —
  // cart_items.user_id and organization_id are both NOT NULL — so the pay-first
  // path takes the purchase and the partnership in one Stripe session instead.
  const auth = await getOptionalAuthContext();
  const cartHref = `/conference/${conference.year}/${conference.edition_code}/cart`;

  // WHICH org is buying must never be a guess.
  //
  // The first version of this took activeOrgIds[0], which showed a partner a
  // disabled "Only partner can buy this" whenever a member or staff org sorted
  // first. The second picked the first org that COULD buy — which quietly
  // charged $750 to an organisation the viewer never named. Caught by clicking
  // it: a cart row appeared under an org I had not asked for.
  //
  // So: `?org=` always decides when present (a global admin may buy for any
  // org, as on the offers page; everyone else only for their own). With one
  // org there is nothing to choose. With several, one is used but it is NAMED
  // on the page with a switcher beside it, so the buyer can see whose money
  // this is before pressing the button.
  const isAdmin = Boolean(auth && isGlobalAdmin(auth.globalRole));
  const ownOrgIds = auth?.activeOrgIds ?? [];
  const requestedOrgId = query.org?.trim();
  const permittedRequest = requestedOrgId && (isAdmin || ownOrgIds.includes(requestedOrgId)) ? requestedOrgId : null;

  let buyerOrgId: string | null = permittedRequest;
  if (!buyerOrgId) {
    for (const orgId of ownOrgIds.slice(0, 5)) {
      const result = await listConferenceOffers(conference.id, orgId);
      const found = result.success ? result.data.find((o) => o.id === offer.id) : undefined;
      if (!found) continue;
      if (!buyerOrgId || found.eligible) buyerOrgId = orgId;
      if (found.eligible) break;
    }
  }

  let pricedOffer = null;
  if (buyerOrgId) {
    const result = await listConferenceOffers(conference.id, buyerOrgId);
    if (result.success) pricedOffer = result.data.find((o) => o.id === offer.id) ?? null;
  }

  const { data: buyerOrg } = buyerOrgId
    ? await db.from("organizations").select("id, name").eq("id", buyerOrgId).maybeSingle()
    : { data: null };

  // Only worth a switcher when there is genuinely a choice to make.
  const { data: switchableOrgs } = ownOrgIds.length > 1
    ? await db.from("organizations").select("id, name").in("id", ownOrgIds).order("name")
    : { data: null };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#EE2A2E] print:hidden">
        Campus Store Conference {conference.year}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#1A1A1A] print:hidden">{offer.name}</h1>
      <p className="mt-1 text-lg font-semibold text-gray-900 print:hidden">{formatCents(offer.price_cents ?? 0)}</p>

      {about ? <p className="mt-6 text-base leading-relaxed text-gray-700 print:hidden">{about}</p> : null}

      {deadlines.length > 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 print:hidden">
          {deadlines.map((d, i) => (
            <p key={i} className="text-sm text-amber-900">
              <strong>{formatDeadline(d.date)}</strong>
              {d.label ? ` — ${d.label}.` : null}
              {d.consequence ? ` ${d.consequence}` : null}
            </p>
          ))}
        </div>
      ) : null}

      {rules ? (
        <section className="mt-8 print:hidden">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">What to send</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{rules}</p>
        </section>
      ) : null}

      {shipTo ? (
        <section id="shipping-label" className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900 print:hidden">Where to send it</h2>
          <p className="mt-1 text-sm text-gray-600 print:hidden">
            Print this label and fix it to your carton. McMaster&apos;s receiving dock handles
            a high volume of deliveries that have nothing to do with the conference, so a
            carton marked this way reaches the right place without anyone having to work out
            what it is.
          </p>

          {/*
            The label itself. Printing the page yields this and nothing else:
            every other block is `print:hidden`, and the media query below drops
            the site header and footer, which sit outside this component.

            `marking` is set in the largest type on the label on purpose — it is
            the line the person on the dock reads first, and it is the one that
            decides whether the carton goes to the assembly area or into general
            bookstore receiving.
          */}
          <div className="label-sheet mt-4 rounded-lg border-2 border-gray-900 bg-white p-6 print:mt-0 print:rounded-none print:border-[3px] print:p-10">
            <p className="text-center text-2xl font-extrabold uppercase tracking-wide text-gray-900 print:text-6xl print:leading-tight">
              {shipTo.marking}
            </p>
            <div className="mt-5 border-t-2 border-gray-900 pt-5 print:mt-6 print:pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Deliver to</p>
              {shipTo.attention ? (
                <p className="mt-2 text-lg font-semibold text-gray-900 print:text-3xl">{shipTo.attention}</p>
              ) : null}
              {shipTo.company ? (
                <p className="text-lg font-semibold text-gray-900 print:text-3xl">{shipTo.company}</p>
              ) : null}
              {(shipTo.lines ?? []).map((line) => (
                <p key={line} className="text-lg text-gray-900 print:text-3xl">
                  {line}
                </p>
              ))}
              {shipTo.city_line ? (
                <p className="text-lg text-gray-900 print:text-3xl">{shipTo.city_line}</p>
              ) : null}
            </div>
            {deadlines[0]?.date ? (
              <p className="mt-5 border-t border-gray-300 pt-3 text-sm text-gray-700 print:mt-6 print:text-base">
                Must arrive by <strong>{formatDeadline(deadlines[0].date)}</strong>
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
            <PrintButton
              label="Print this label"
              className="rounded-md bg-[#EE2A2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#b50001]"
            />
            <span className="text-xs text-gray-500">
              One sheet, 8.5&quot; × 11&quot; landscape.
            </span>
          </div>

          <p className="mt-3 text-xs text-gray-500 print:hidden">
            You cover the shipping to Hamilton. CSC covers sending it out to every member
            store from there.
          </p>
        </section>
      ) : null}

      {/*
        Print the label, not the page. The site header and footer are rendered by
        the layout and cannot be reached with a `print:hidden` class from here, so
        they are hidden the same way app/benchmarking/worksheet does it.
      */}
      {/*
        Print the label, not the page.

        The site header and footer come from the layout and cannot be reached
        with a `print:hidden` class from here, so they go the same way
        app/benchmarking/worksheet does it.

        ⛔ The @page rule names Letter explicitly. Without one the browser uses
        whatever default the machine has, and a label laid out for 8.5×11 that
        comes out of an A4 default is cropped at the right edge — on the address,
        which is the only part that matters.

        LANDSCAPE, because the marking is what this sheet is for. Across the long
        edge "CONFERENCE IN A BOX" gets ~9.9in of line rather than ~7.4in, so it
        sets about a third larger before it wraps — and a label is read from
        across a loading dock, not held at arm's length.

        The height follows from that: landscape Letter at 14mm margins leaves
        7.4in ≈ 188mm of usable height, so the sheet is 180mm. It was 240mm for
        portrait; leaving it there would have pushed a second, blank page out of
        the tray behind every label.
      */}
      <style>{`
        @page { size: Letter landscape; margin: 14mm; }
        @media print {
          header, footer, nav { display: none !important; }
          html, body { background: #fff !important; }
          #shipping-label { margin: 0 !important; }
          #shipping-label .label-sheet {
            display: flex !important;
            flex-direction: column;
            justify-content: center;
            min-height: 180mm;
            box-sizing: border-box;
          }
        }
      `}</style>

      <section className="mt-10 print:hidden">
        {pricedOffer ? (
          <>
            {buyerOrg && (switchableOrgs?.length ?? 0) > 1 ? (
              <div className="mb-3 max-w-md">
                <AdminOrgSwitcher
                  orgs={switchableOrgs!}
                  selectedOrgId={buyerOrg.id}
                  basePath="/conference-in-a-box"
                  label="buying as"
                />
              </div>
            ) : buyerOrg ? (
              <p className="mb-3 text-sm text-gray-600">
                Buying as <span className="font-medium text-gray-900">{buyerOrg.name}</span>.
              </p>
            ) : null}
            <div className="max-w-md">
              <OfferCard
                offer={pricedOffer}
                conferenceId={conference.id}
                organizationId={buyerOrgId!}
                goToAfterAdd={cartHref}
              />
            </div>
            <p className="mt-3 text-xs text-gray-500">
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
                href={`/login?next=${encodeURIComponent("/conference-in-a-box")}`}
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
    </div>
  );
}
