import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { formatCents } from "@/lib/utils";

export const metadata = { title: "Conference in a Box" };
export const dynamic = "force-dynamic";

/**
 * Top level, not under /conference/[year]/[edition]/.
 *
 * Every route under a conference edition is about attending one: register,
 * schedule, floor plan, exhibit, welcome. Conference in a Box is the one
 * product a partner buys *without* attending — the whole pitch is that it
 * reaches the buyer who cannot travel. Filing it under an edition implies a
 * prerequisite that does not exist, and the offer itself carries no booth
 * dependency (its refs are `who -> Partner` and `requires -> Membership
 * Renewal`). So it sits beside /partnership and /membership instead.
 *
 * Deliberately public, no login. A partner forwards this to whoever actually
 * picks the sample, and that person may have no CSC account.
 *
 * ⛔ The page explains; it does not sell. A logged-out add-to-cart is not a
 * gate to relax: cart_items.user_id and cart_items.organization_id are both
 * NOT NULL and addOfferToCart opens with assertUserCanManageOrg, so there is
 * nowhere to write the row. The buy path is a login bounce onto the offer.
 */

// Set by the Board 2026-09-24. The original December 4 postmark was dropped as
// unworkable: it fell in the store's busiest receiving period and immediately
// before the holiday closure. Not derivable from the entity.
const ARRIVE_BY = "Friday, November 20, 2026";

const SHIP_TO = [
  "Campus Store, McMaster University",
  "1280 Main Street West, Gilmour Hall B-101",
  "Hamilton, ON L8S 1C7",
];

const OFFER_NAME = "Conference in a Box";

export default async function ConferenceInABoxPage() {
  const db = createAdminClient();

  // Resolve the conference from the product rather than from a URL segment:
  // the page is about the offer, so the right conference is whichever visible
  // one currently sells it. Soonest start date wins when more than one does.
  const { data: offers } = await db
    .from("conference_entities")
    .select("id, price_cents, is_for_sale, conference_instances!inner(year, edition_code, name, status, start_date, location_city)")
    .eq("name", OFFER_NAME)
    .eq("is_for_sale", true);

  const live = (offers ?? [])
    .map((row) => {
      const conf = Array.isArray(row.conference_instances)
        ? row.conference_instances[0]
        : row.conference_instances;
      return { offer: row, conf };
    })
    .filter(
      ({ conf }) =>
        conf &&
        VISIBLE_CONFERENCE_STATUSES.includes(conf.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number])
    )
    .sort((a, b) => String(a.conf!.start_date ?? "").localeCompare(String(b.conf!.start_date ?? "")));

  const current = live[0];
  if (!current?.conf) notFound();

  const { offer, conf } = current;
  const priceLabel = offer.price_cents ? formatCents(offer.price_cents) : null;

  const offerPath = `/conference/${conf!.year}/${conf!.edition_code}/offers?offer=${offer.id}#offer-${offer.id}`;
  const viewer = await getViewerContext();
  const isSignedIn = Boolean(viewer.userId);
  const ctaHref = isSignedIn ? offerPath : `/login?next=${encodeURIComponent(offerPath)}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-[#1A1A1A]">Conference in a Box</h1>
      <p className="mt-3 text-[#1A1A1A]/90">
        Conference in a Box puts one of your products into every member store before{" "}
        {conf!.name}. The buyer who cannot travel to {conf!.location_city ?? "the show"} still gets
        to hold the thing, which is the part a booth alone has never solved.
      </p>

      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">What it costs</h2>
        <p className="mt-1 text-[#1A1A1A]/90">
          {priceLabel ? (
            <>
              <strong>{priceLabel}</strong> for partners without a Connected Exhibitor booth.
            </>
          ) : (
            <>Pricing is being finalised.</>
          )}{" "}
          If you hold a Connected Exhibitor booth it is already included, and there is nothing to buy.
        </p>
      </section>

      <BulletSection
        title="What to send"
        items={[
          "One item, no larger than a hoodie. A hoodie itself is perfectly good.",
          "It cannot be personalized for individual institutions.",
          "Decorating a sample? Use the CSC logo and we will send you the file.",
          "Add your show-special one-page flyer.",
          "Lookbooks are welcome if they run about twenty pages or fewer. No catalogs.",
          "Too big for a box that size? Ship it separately at your own cost so it arrives at the same time, and mark it clearly.",
        ]}
      />

      <section className="mt-8">
        <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">When it has to arrive</h2>
        <p className="mt-2 text-[#1A1A1A]/90">
          Your shipment needs to arrive by <strong>{ARRIVE_BY}</strong>. That date is deliberate. It
          lands before the campus receiving crush and before the holiday closure, so the boxes
          actually get packed.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">Where to send it</h2>
        <address className="mt-2 not-italic text-[#1A1A1A]/90">
          {SHIP_TO.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
        <p className="mt-2 text-[#1A1A1A]/90">
          You cover getting it to Hamilton. We cover getting it out to every store from there.
        </p>
      </section>

      <div className="mt-10">
        <Link
          href={ctaHref}
          className="inline-block rounded-md bg-[#EE2A2E] px-7 py-3 text-base font-bold text-white no-underline hover:bg-[#d4252a]"
        >
          {isSignedIn ? "Add Conference in a Box" : "Sign in to reserve your spot"}
        </Link>
        {!isSignedIn && (
          <p className="mt-2 text-sm text-[#6B6B6B]">
            Reserving is tied to your partner account, so this step needs a sign-in. Everything above
            is yours to forward to whoever picks the sample.
          </p>
        )}
      </div>
    </div>
  );
}

function BulletSection({ title, items }: { title: string; items: React.ReactNode[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide text-[#6B6B6B]">{title}</h2>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[#1A1A1A]/90">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EE2A2E]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
