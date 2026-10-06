import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalAuthContext, isGlobalAdmin } from "@/lib/auth/guards";
import { SALES_OPEN_STATUSES } from "@/lib/constants/conference";
import { listConferenceOffers } from "@/lib/actions/conference-entities";
import { loadTopicBoard } from "@/lib/actions/conference-topics";
import OfferCard from "@/components/conference/OfferCard";
import TopicBoard from "@/components/conference/TopicBoard";

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
  searchParams: Promise<{ org?: string }>;
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

  const { data: session } = await db
    .from("conference_entities")
    .select("id, name, attributes")
    .eq("conference_id", conference.id)
    .eq("name", "Big Ideas Day")
    .maybeSingle();
  if (!session) notFound();

  const attrs = (session.attributes as Record<string, unknown> | null) ?? {};
  const purpose = typeof attrs.purpose === "string" ? attrs.purpose : null;

  const auth = await getOptionalAuthContext();
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

  const board = buyerOrgId ? await loadTopicBoard(conference.id, buyerOrgId) : null;

  const signInHref = `/login?next=${encodeURIComponent("/big-ideas-day")}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#EE2A2E]">
        {conference.name}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#1A1A1A]">Big Ideas Day</h1>

      {purpose ? (
        <p className="mt-6 text-base leading-relaxed text-gray-700">{purpose}</p>
      ) : null}

      {/*
        Wording shared with the invitation emails on purpose — "unconference"
        and "participant, not an exhibitor". A reader who clicks through from
        the email should meet the same words twice rather than wonder whether
        this is the same thing.
      */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">How the day runs</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          It runs as an <strong>unconference</strong>.
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700">
          <li>
            The main room runs table conversations that members and vendors put forward in
            advance. Pull up a chair at whichever table you want, and move when the
            conversation stops being useful to you.
          </li>
          <li>A second room runs short presentations. Everyone drifts between the two.</li>
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
      </section>

      {/*
        Signed out: the room, not the price. Participation costs different
        amounts for different partners and nothing at all for members, so any
        number shown here would be wrong for most readers.
      */}
      {!auth ? (
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
          {alreadyIn ? (
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
              <p className="mt-1 text-sm text-gray-600">
                Big Ideas Day is included with any conference registration — you just need to
                be registered.
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
        />
      ) : null}
    </div>
  );
}
