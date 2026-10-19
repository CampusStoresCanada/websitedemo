import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import AgendaView from "@/components/me/AgendaView";
import { loadPersonAgenda } from "@/lib/conference/person-agenda";
import { getSwapState } from "@/lib/actions/conference-swaps";
import { listConferenceOffers, type ConferenceOffer } from "@/lib/actions/conference-entities";
import { loadSeatHoldings } from "@/lib/conference/seats";
import { isConferenceOnSale, type ConferenceStatus } from "@/lib/constants/conference";
import { selfBuyableOffers, unassignedByEntity } from "@/lib/conference/self-purchase";
import OfferCard from "@/components/conference/OfferCard";

/**
 * The attendee's own conference to-dos, on the page they already use.
 *
 * Mirrors what ConferenceChecklistSection does for an organisation. The
 * details a person supplies — dietary, travel, emergency contact — are not
 * here: those live behind Edit, in the same modal they use to change their
 * name, because that is the one path for "change something about me".
 *
 * What is left is genuinely a checklist: things only they can confirm, where
 * "doesn't apply to me" is a complete answer.
 *
 * It is also where a badge lands when somebody scans their OWN badge — the
 * `me` scan destination. That is why the extras their organisation can buy sit
 * here: standing in the hall with a phone is exactly when somebody decides
 * they want two more seats at tonight's reception, and the badge in their hand
 * is the only thing they have to get here with.
 */
export default async function MyConferenceSection() {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const db = createAdminClient();
  const { data: people } = await db
    .from("conference_people")
    .select(
      "id, conference_id, organization_id, conference_instances!inner(name, year, edition_code, status)"
    )
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1);

  const person = (people ?? [])[0] as unknown as {
    id: string;
    conference_id: string;
    // ⛔ NOT NULL, and it is the buyer of record. The organisation holding this
    // person's seat is the one an extra gets billed to — not "whichever of the
    // viewer's organisations came back first", which is a different answer for
    // anybody who works at two.
    organization_id: string;
    conference_instances: {
      name: string;
      year: number;
      edition_code: string;
      status: string;
    } | null;
  } | undefined;
  if (!person) return null;

  // Check-ins are no longer loaded here — they arrive with the obligations in
  // the edit modal, which is the one place a person answers anything about
  // themselves. The agenda still lists them as outstanding.
  const agendaResult = await loadPersonAgenda(person.id, person.conference_id);
  const agenda = agendaResult.success ? agendaResult.data : null;

  /**
   * How many swaps are left, and whether the schedule is final — read here so
   * the agenda can say "swaps are closed" instead of offering a button the
   * server would refuse. Reading never consumes a swap; only requesting does.
   */
  const swapState =
    agenda?.meetingSeatId && agenda.items.some((i) => i.reason === "meeting")
      ? await getSwapState(person.conference_id, agenda.meetingSeatId)
      : null;
  const swap = swapState?.success ? swapState.data : null;
  const conference = person.conference_instances;

  // ⚠️ Only while commerce is actually live. `announced` is public but nothing
  // is purchasable, and a storefront that takes money for a conference not yet
  // selling is worse than no storefront.
  let buyable: ConferenceOffer[] = [];
  let freeSeatsByEntity = new Map<string, number>();

  if (isConferenceOnSale((conference?.status ?? "draft") as ConferenceStatus)) {
    // ⛔ listConferenceOffers authorises on `activeOrgIds` — every organisation
    // the viewer belongs to, at ANY role. That is deliberate and it is what
    // makes this work: the fifth person on a booth is rarely the org admin, and
    // needing an admin to buy a reception ticket is the queue this removes. It
    // still refuses an organisation they have no link to.
    const offersResult = await listConferenceOffers(person.conference_id, person.organization_id);
    buyable = offersResult.success ? selfBuyableOffers(offersResult.data) : [];

    if (buyable.length > 0) {
      // ⛔ Reported, never used to hide an offer: an org with one spare ticket
      // and a guest who needs four still has to buy three. Deciding for them by
      // removing the card is how somebody ends up unable to buy at all.
      const { seats } = await loadSeatHoldings(db, {
        conferenceId: person.conference_id,
        organizationId: person.organization_id,
        assigned: false,
      });
      freeSeatsByEntity = unassignedByEntity(seats);
    }
  }

  // Nothing to show and nothing to link to is not a section, it is a heading.
  if (!agenda?.items.length && !agenda?.deadlines.length && !conference && !buyable.length) {
    return null;
  }

  return (
    <section id="conference_checklist" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {conference?.name ?? "Conference"}
        </h2>
        {/*
          The "Your schedule →" link is gone: it pointed at
          /conference/[year]/[edition]/schedule, which now redirects straight
          back to this section. A link that returns you to where you already are
          is worse than no link.
        */}
      </div>

      {/*
        ⛔ DEADLINES RENDER EVEN WITH AN EMPTY SCHEDULE. This was gated on
        `items.length > 0`, which meant a registered attendee whose schedule has
        not been built yet saw none of what they owe — and since the meeting
        schedule is built FROM these answers, that is everybody at the point we
        are asking. The block is "Before you go", not a view of the agenda.
      */}
      {agenda && (agenda.items.length > 0 || agenda.deadlines.length > 0) && conference && (
        <AgendaView
          agenda={agenda}
          mapHref={`/conference/${conference.year}/${conference.edition_code}/map`}
          conferenceId={person.conference_id}
          swap={swap}
        />
      )}

      {conference && buyable.length > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Add something</h3>
            {/*
              ⚠️ A link OUT, not back here. The "Your schedule →" link above was
              removed because it returned the reader to the section they were
              already in; the cart is a different page that does something.
            */}
            <Link
              href={`/conference/${conference.year}/${conference.edition_code}/cart?org=${person.organization_id}`}
              className="text-sm font-medium text-[#163D6D] hover:underline"
            >
              Your cart &rarr;
            </Link>
          </div>
          {/*
            ⛔ Says WHO PAYS, before anything is added. The organisation is the
            buyer of record — it lands on their invoice and their tax treatment,
            and a ticket bought here belongs to them, not to the person who
            tapped the button. Someone adding four reception seats on a phone
            has no other way to know that.
          */}
          <p className="mt-1 text-xs text-gray-600">
            Anything you add is bought by your organisation and goes on their invoice.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {buyable.map((offer) => {
              const free = freeSeatsByEntity.get(offer.id) ?? 0;
              return (
                <div key={offer.id}>
                  <OfferCard
                    offer={offer}
                    conferenceId={person.conference_id}
                    organizationId={person.organization_id}
                  />
                  {free > 0 ? (
                    <p className="mt-1 px-1 text-xs text-amber-700">
                      Your organisation already has {free} unassigned — someone can name a
                      person to {free === 1 ? "it" : "one"} on their page instead of buying more.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

    </section>
  );
}
