import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalAuthContext, isGlobalAdmin } from "@/lib/auth/guards";
import { SALES_OPEN_STATUSES } from "@/lib/constants/conference";
import { listConferenceOffers } from "@/lib/actions/conference-entities";
import { loadTopicBoard } from "@/lib/actions/conference-topics";
import OfferCard from "@/components/conference/OfferCard";
import TopicBoard from "@/components/conference/TopicBoard";
import { PRESENTATION_MINUTES, clock, loadBigIdeasDay, loadPartnersInRoom, toMinutes } from "@/lib/conference/big-ideas-day";
import { getNamedProspectOffers } from "@/lib/actions/prospective-booth-checkout";
import ExhibitCheckoutForm from "../conference/[year]/[edition]/exhibit/exhibit-checkout-form";

/**
 * Big Ideas Day — one public page that changes with who is reading it.
 *
 * NOT N routes. The conference has separate routes for /attend and /exhibit
 * because those are different products; this is one product with different
 * readers, and N copies of the description would go stale at N different rates.
 *
 * ⛔ No pricing until someone signs in. Participation is sold at different
 * rates to different partners and included outright for members, so a public
 * number would be wrong for nearly everyone who read it. The public page sells
 * the room; the price arrives once we know who is asking.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Big Ideas Day",
  description:
    "The day of the Campus Store Conference built for conversation rather than transaction.",
};

/**
 * Topics in, then the members' vote, then the refunds.
 *
 * Steve: "We collect the $250 up front. Voting takes place in December, please
 * have your pitch in by December 4th. The members vote the next week, we
 * announce the winners and refund right after."
 *
 * The emails carry the same deadline. December 4 2026 is a Friday, checked.
 * The vote week is deliberately "the following week" rather than a second date,
 * matching the wording in all five emails.
 */
const PITCH_DEADLINE = { iso: "2026-12-04", label: "Friday, December 4" };

export default async function BigIdeasDayPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; fixtures?: string; suggest?: string }>;
}) {
  const query = await searchParams;
  const db = createAdminClient();

  // Same resolution /conference-in-a-box and /org/[slug] use — one answer to
  // "which conference is selling right now".
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, year, edition_code, name, end_date, status")
    .in("status", SALES_OPEN_STATUSES as unknown as string[])
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!conference) notFound();

  // Which day, which rooms, when presentations run: one reader, shared with
  // the staff panel that places pitches into these same windows.
  const day = await loadBigIdeasDay(db, conference.id);
  if (!day) notFound();
  const session = { id: day.sessionId };
  const { purpose, dayLabel, dayStart, dayEnd, tablesRoom, talksRoom, meals, talkWindows } = day;

  // The presentation room's day in order: what is served, and the stretches
  // between where presentations run.
  const glance = [
    ...meals.map((m) => ({ start: toMinutes(m.start), end: toMinutes(m.end), label: m.label, talks: false })),
    ...talkWindows.map((w) => ({ ...w, label: "Presentations", talks: true })),
  ].sort((a, z) => a.start - z.start);

  const auth = await getOptionalAuthContext();

  /*
    The "suggest a topic" link, made to be posted in Circle:
    /big-ideas-day?suggest=1. Signed in, it lands on the open form. Signed
    out, it goes through sign-in and comes back to the same link, so the form
    is the first thing a member sees either way.
  */
  const suggest = query.suggest === "1";
  if (suggest && !auth) {
    redirect(`/login?next=${encodeURIComponent("/big-ideas-day?suggest=1")}`);
  }
  const isAdmin = Boolean(auth && isGlobalAdmin(auth.globalRole));
  const ownOrgIds = auth?.activeOrgIds ?? [];
  const requested = query.org?.trim();
  const buyerOrgId =
    (requested && (isAdmin || ownOrgIds.includes(requested)) ? requested : null) ?? ownOrgIds[0] ?? null;

  const { data: org } = buyerOrgId
    ? await db.from("organizations").select("id, name, type").eq("id", buyerOrgId).maybeSingle()
    : { data: null };

  // What this org can actually buy — the named-partner rates, or the member
  // registrations. listConferenceOffers already answers both, including the
  // direct-purchase offers this org is named on.
  const offersResult = buyerOrgId ? await listConferenceOffers(conference.id, buyerOrgId) : null;
  const offers = offersResult?.success ? offersResult.data : [];
  const bigIdeasOffers = offers.filter((o) => /^Big Ideas Day/.test(o.name));

  /*
    ⛔ ASK THE GRAPH WHETHER IT PUTS YOU IN THE ROOM. Never match on the name.

    This read `/Day Pass|Full Conference Registration/`, which is a proxy for
    the entitlement rather than the entitlement itself — and the proxy was
    wrong the day it was written. Only Full Conference Registration and the
    Thursday Day Pass carry `involved_in -> Big Ideas Day`; the Tuesday and
    Wednesday passes do not. So the page offered four ways in under the
    sentence "included with any conference registration", and two of them
    bought a member a $199 pass to a day they would not be admitted to.

    `accessSummary` is built from the same access walk that decides what the
    card lists, so a registration that stops granting Big Ideas Day drops out
    of this list and off its own What's-included bullet in the same edit.
    `session.id` is the entity this page already resolved by name at the top —
    not a second hardcoded uuid alongside the two in the components.
  */
  const memberWayIn = offers.filter((o) =>
    o.accessSummary.tradeShowDays.some((d) => d.id === session.id)
  );

  // Already in the room? Either they hold something that reaches the session,
  // or their booth does.
  const { data: reach } = buyerOrgId
    ? await db
        .from("entity_balances")
        .select("entity_id")
        .eq("conference_id", conference.id)
        .eq("organization_id", buyerOrgId)
    : { data: null };
  const { data: involvedRefs } = await db
    .from("conference_entity_refs")
    .select("from_entity_id")
    .eq("conference_id", conference.id)
    .eq("role", "involved_in")
    .eq("to_entity_id", session.id);
  const admitting = new Set((involvedRefs ?? []).map((r) => r.from_entity_id));
  const alreadyIn = (reach ?? []).some((b) => b.entity_id && admitting.has(b.entity_id));

  /*
    Which partners are coming, for everyone including a signed-out reader.

    Kari, via Sean, 2026-11-19: "the description doesn't give much and I think
    having a way to see who is signed up would help." The rule for who counts
    lives in loadPartnersInRoom, and the "already in the room" line below reads
    the same answer.
  */
  const partnersInRoom = await loadPartnersInRoom(db, conference.id, session.id);
  const inRoomAsPartner = Boolean(buyerOrgId && partnersInRoom.some((p) => p.id === buyerOrgId));

  // The board is public: what has been pitched is half of "what is this day".
  // Picking and proposing still need a sign-in, which loadTopicBoard decides.
  // ?fixtures=1 is honoured for staff only, inside loadTopicBoard.
  const board = await loadTopicBoard(conference.id, buyerOrgId, { fixtures: query.fixtures === "1" });

  const signInHref = `/login?next=${encodeURIComponent("/big-ideas-day")}`;

  /*
    A company we have on file but that has not joined yet, reading its own link
    (/big-ideas-day?org=<its id>). It has no login, so the price cannot wait for
    one: the link is what says who is asking. It buys its rate and the
    partnership in one checkout, the same pay-first flow /exhibit and
    /conference-in-a-box use, and the board reviews the application afterwards.

    Null for anyone not named on a Big Ideas Day rate, so a guessed or stale
    link falls through to the ordinary signed-out page.
  */
  const namedProspect =
    !auth && requested
      ? await getNamedProspectOffers({ conferenceId: conference.id, prospectOrganizationId: requested })
      : null;
  const prospectOffers = (namedProspect?.offers ?? []).filter((o) => /^Big Ideas Day/.test(o.name));

  // A company reading its own pay-first link came here to buy, so its checkout
  // stays near the top. For everyone else the price follows what is on.
  const buyFirst = Boolean(!auth && namedProspect && prospectOffers.length > 0);

  const takingPart = (
    <>
      {/*
        Signed out: the room, not the price. Participation costs different
        amounts for different partners and nothing at all for members, so any
        number shown here would be wrong for most readers.
      */}
      {!auth && namedProspect && prospectOffers.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900">Taking part</h2>
          <p className="mt-1 text-sm text-gray-600">
            You would be there as a <strong>participant, not an exhibitor</strong>. Nothing
            to set up, no stand to manage. This is your rate as {namedProspect.prospect.name},
            and your CSC partnership is charged in the same checkout.
          </p>
          <ExhibitCheckoutForm
            conferenceId={conference.id}
            conferenceYear={conference.year}
            conferenceEdition={conference.edition_code}
            booths={prospectOffers}
            label="What you're buying"
            namePrefix=""
            prospect={namedProspect.prospect}
            successUrl={`/conference/${conference.year}/${conference.edition_code}/exhibit/success?session_id={CHECKOUT_SESSION_ID}`}
            cancelUrl={`/big-ideas-day?org=${namedProspect.prospect.id}`}
            footnote="Your card is charged for Big Ideas Day plus CSC partnership dues. This does not guarantee approval. The CSC board reviews every new partner application after payment."
          />
          <p className="mt-3 text-sm text-gray-600">
            Already have a CSC login?{" "}
            <Link href={signInHref} className="font-medium text-[#EE2A2E] hover:underline">
              Sign in
            </Link>{" "}
            and buy from your account instead.
          </p>
        </section>
      ) : !auth ? (
        <section className="mt-10 rounded-xl border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-lg font-semibold text-gray-900">Taking part</h2>
          <p className="mt-1 text-sm text-gray-600">
            What it costs depends on who you are — it is included for member stores, and
            partners take part at a rate we will show you once you are signed in.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={signInHref}
              className="rounded-md bg-[#EE2A2E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#b50001]"
            >
              Sign in to see your rate
            </Link>
            <Link
              href="/apply"
              className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-white"
            >
              Not with CSC yet? Apply
            </Link>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            New applications are reviewed by the CSC board, so joining is not instant.
          </p>
        </section>
      ) : null}

      {auth && org ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900">Taking part</h2>
          {alreadyIn || inRoomAsPartner ? (
            <p className="mt-1 text-sm text-gray-700">
              <strong>You&apos;re already in the room.</strong> Big Ideas Day is included with
              what {org.name} already holds — there is nothing more to buy.
            </p>
          ) : bigIdeasOffers.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-gray-600">
                You would be there as a <strong>participant, not an exhibitor</strong> —
                nothing to set up, no stand to manage. Your rate as {org.name}:
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {bigIdeasOffers.map((offer) => (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    conferenceId={conference.id}
                    organizationId={buyerOrgId!}
                  />
                ))}
              </div>
            </>
          ) : org.type === "Member" ? (
            <>
              {/*
                ⛔ "ANY conference registration" was false and stayed false
                after the list above it was fixed. The Tuesday and Wednesday
                day passes do not carry Big Ideas Day, so a member already
                holding one read "you just need to be registered" and
                concluded they were in the room.

                The sentence now points AT the list rather than making its own
                claim about the catalogue, so it cannot drift from what the
                graph actually grants — the same reason the list stopped
                matching on names.
              */}
              <p className="mt-1 text-sm text-gray-600">
                {memberWayIn.length > 0
                  ? "Big Ideas Day is included with the registrations below — you need to be holding one of them."
                  : "Big Ideas Day is included with a conference registration. Nothing that covers it is on sale right now."}
              </p>
              {memberWayIn.length > 0 ? (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {memberWayIn.map((offer) => (
                    <OfferCard
                      key={offer.id}
                      offer={offer}
                      conferenceId={conference.id}
                      organizationId={buyerOrgId!}
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-600">
              Partner places on Big Ideas Day are offered by invitation. Talk to us if you
              would like to be in the room.
            </p>
          )}
        </section>
      ) : null}
    </>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#EE2A2E]">
        {conference.name}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#1A1A1A]">Big Ideas Day</h1>

      {/*
        When and where, before anything else. The page used to describe the day
        without ever saying which day it was.
      */}
      {dayLabel || (dayStart && dayEnd) ? (
        <p className="mt-2 text-sm font-medium text-gray-700">
          {[
            dayLabel,
            dayStart && dayEnd ? `${clock(toMinutes(dayStart))} to ${clock(toMinutes(dayEnd))}` : null,
            [tablesRoom, talksRoom].filter(Boolean).join(" and ") || null,
          ]
            .filter(Boolean)
            .join(" \u00b7 ")}
        </p>
      ) : null}

      {purpose ? (
        <p className="mt-6 text-base leading-relaxed text-gray-700">{purpose}</p>
      ) : null}

      {glance.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            The day at a glance
          </h2>
          {tablesRoom && dayStart && dayEnd ? (
            <p className="mt-3 text-sm leading-relaxed text-gray-700">
              <strong>Table conversations</strong> run in {tablesRoom} from{" "}
              {clock(toMinutes(dayStart))} to {clock(toMinutes(dayEnd))}. Alongside them, in{" "}
              {talksRoom}:
            </p>
          ) : null}
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {glance.map((row) => (
              <li key={`${row.start}-${row.label}`} className="flex gap-4 px-4 py-2.5 text-sm">
                <span className="w-28 shrink-0 tabular-nums text-gray-500">
                  {clock(row.start)} to {clock(row.end)}
                </span>
                <span className={row.talks ? "font-semibold text-gray-900" : "text-gray-600"}>
                  {row.label}
                  {row.talks ? (
                    <span className="ml-2 font-normal text-gray-500">{PRESENTATION_MINUTES} minutes each</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {buyFirst ? takingPart : null}

      {board?.success ? (
        <TopicBoard
          conferenceId={conference.id}
          organizationId={buyerOrgId}
          topics={board.data.topics}
          hasBallot={board.data.hasBallot}
          canVote={board.data.canVote}
          canPropose={board.data.canPropose}
          proposeBlockedReason={board.data.proposeBlockedReason}
          deadlineLabel={PITCH_DEADLINE.label}
          tablesRoom={tablesRoom}
          talksRoom={talksRoom}
          presentationMinutes={PRESENTATION_MINUTES}
          signedOut={!auth}
          openPropose={suggest}
        />
      ) : null}

      {partnersInRoom.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Partners in the room so far
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {partnersInRoom.map((partner) => (
              <span
                key={partner.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700"
              >
                {partner.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={partner.logoUrl} alt="" className="h-4 w-4 rounded-full object-contain" />
                ) : null}
                {partner.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {buyFirst ? null : takingPart}

      {/*
        Wording shared with the invitation emails on purpose — "unconference"
        and "participant, not an exhibitor". A reader who clicks through from
        the email should meet the same words twice rather than wonder whether
        this is the same thing.
      */}
      <section className="mt-12 border-t border-gray-200 pt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">How it works</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          It runs as an <strong>unconference</strong>.
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700">
          <li>
            {tablesRoom ? <strong>{tablesRoom}</strong> : "The main room"} runs table
            conversations that members put forward in advance. Pull up a chair at whichever
            table you want, and move when the conversation stops being useful to you.
          </li>
          <li>
            {talksRoom ? <strong>{talksRoom}</strong> : "A second room"} runs{" "}
            {PRESENTATION_MINUTES}-minute presentations from partners. You can drift between
            the two rooms all day.
          </li>
          <li>
            Presenters stay in the room afterwards rather than packing up, so a session
            starts a conversation instead of ending one.
          </li>
          {/*
            ⛔ This said "the manager and director sessions folded into this
            day". Removed 2026-10-06: it came to me from another session citing
            the Town Hall recording, I never saw that recording, and Steve — who
            ran the town hall — did not recognise the claim. It was never in the
            invitation emails either, so the page was the only place it reached a
            reader. Do not restore it without a source someone can point at.
          */}
          <li>
            It is open to every role in the store, not only the general merchandise buyer —
            the course materials person, the operations lead and the people who never get
            sent to a trade show are all in the room.
          </li>
        </ul>

        {/*
          Moved here from above the lists, 2026-11-20, so a member reaches the
          first thing they can vote on without reading five paragraphs. The
          words are the ones the board carried; only the place changed.
        */}
        <h3 className="mt-6 text-sm font-semibold text-gray-900">Voting and picking</h3>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-gray-700">
          <p>
            If none of it appeals, say so, because that tells us something silence
            doesn&apos;t. Either way come back later, since people keep adding and the list
            in December won&apos;t be the list today.
          </p>
          <p>
            Picking a table conversation isn&apos;t a ballot and it isn&apos;t binding on us.
            We aren&apos;t choosing on votes alone, we might fold two topics together when
            they&apos;re really the same conversation, and we&apos;ll place things so the day
            holds together. What your picks do is tell us what people actually want to spend
            an hour on, which is the thing we can&apos;t guess from here.
          </p>
          <p>
            One thing worth knowing before you pick. If you choose a table conversation, be
            ready to sit at that table on the day. You don&apos;t need to prepare anything,
            bring slides, or have the answer. Just turn up and talk.
          </p>
          <p>
            Change your mind as often as you like. Nothing&apos;s final until we publish the
            day.
          </p>
        </div>
      </section>
    </div>
  );
}
