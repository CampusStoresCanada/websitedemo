/**
 * /admin/elections/[slug] — the nominating committee's working view.
 *
 * Deliberately NOT an approval screen. By-Law Part V has no slate-approval gate:
 * an election happens if more validated nominees stand than there are seats, and
 * otherwise the slate is acclaimed. What the committee actually does is talk to
 * people — about withdrawing where they are unlikely to be elected, and about
 * whether the slate reflects the membership. That is continuous work, so this
 * page is a picture to return to, not a decision to make once.
 *
 * The only action offered is "ask to withdraw", and it is worded as a request
 * because that is all it is — the nominee decides.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import RepresentationPanel from "@/components/admin/elections/RepresentationPanel";
import { getCommitteeReview } from "@/lib/elections/service";
import {
  requestWithdrawalAction,
  sendCallForNominationsAction,
  chaseIncompleteAction,
} from "@/lib/actions/elections";

export const metadata = { title: "Election | Admin | Campus Stores Canada" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warn" | "good";
  hint?: string;
}) {
  const tones = {
    neutral: "text-gray-900",
    warn: "text-amber-700",
    good: "text-green-700",
  } as const;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export default async function ElectionReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const review = await getCommitteeReview(slug);
  if (!review) notFound();

  const { election, eligibility, nominations, validated, incomplete, representation, projected, daysUntilNominationsClose } =
    review;
  const callSentAt = (election.config as unknown as { callSentAt?: string }).callSentAt ?? null;

  async function askToWithdraw(formData: FormData) {
    "use server";
    await requestWithdrawalAction(String(formData.get("nominationId")));
  }

  async function sendCall() {
    "use server";
    await sendCallForNominationsAction(slug);
  }

  async function chase() {
    "use server";
    await chaseIncompleteAction(slug);
  }

  const closing =
    daysUntilNominationsClose > 0
      ? `${daysUntilNominationsClose} day${daysUntilNominationsClose === 1 ? "" : "s"} left`
      : daysUntilNominationsClose === 0
        ? "closes today"
        : "closed";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`${election.cycleYear} Board election`}
        description={`${election.seatsAvailable} seats · AGM ${formatDate(election.schedule.agmDate)} · nominations ${formatDate(election.schedule.nominationsOpenAt)} – ${formatDate(election.schedule.nominationsCloseAt)} (${closing})`}
      />

      {/* The electorate, which during a renewal cycle is a moving number. */}
      <div className="grid gap-3 sm:grid-cols-4">
        {/* Denominator is CURRENT members, not every org ever in the program —
            "19 of 80" would read as a collapse when 28 of that 80 left years ago. */}
        <Stat
          label="Eligible to vote"
          value={`${eligibility.eligible} / ${eligibility.currentMembers}`}
          tone={eligibility.recoverableByRenewing > 0 ? "warn" : "good"}
          hint={
            eligibility.notCurrentMembers > 0
              ? `${eligibility.notCurrentMembers} former members not counted`
              : undefined
          }
        />
        <Stat
          label="One renewal away"
          value={eligibility.recoverableByRenewing}
          tone={eligibility.recoverableByRenewing > 0 ? "warn" : "good"}
          hint="Eligible the day they renew"
        />
        <Stat label="Validated nominees" value={validated.length} />
        <Stat
          label="Projected"
          value={projected.outcome === "balloted" ? "Ballot" : "Acclaimed"}
          tone={projected.outcome === "balloted" ? "neutral" : "good"}
        />
      </div>

      {eligibility.recoverableByRenewing > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{eligibility.recoverableByRenewing}</strong> member institutions have not completed
          their renewal and cannot nominate, co-sign, or vote until they do. They are not lapsed —
          each becomes eligible the day it pays. This number is re-checked every time this page loads.
        </div>
      )}

      {/* Outbound mail. Both are buttons a person presses, not crons: the
          by-law fixes the earliest date, not the latest, and someone should be
          looking at the eligibility numbers when the call goes out. */}
      <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Email</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {callSentAt ? (
            <p className="text-sm text-gray-600">
              Call for nominations sent {formatDate(callSentAt)}. It cannot be sent again — the
              membership receiving it twice reads as disorganisation.
            </p>
          ) : (
            <form action={sendCall} className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20]"
              >
                Send the call for nominations
              </button>
              <span className="text-xs text-gray-500">
                Emails every administrator at the {eligibility.eligible} currently eligible
                institutions. Sends once.
              </span>
            </form>
          )}

          {incomplete.length > 0 && (
            <form action={chase} className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Chase {incomplete.length} incomplete nomination
                {incomplete.length === 1 ? "" : "s"}
              </button>
              <span className="text-xs text-gray-500">Safe to repeat.</span>
            </form>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Election mail is transactional, so it reaches members who have unsubscribed from
          marketing — being unable to receive your own nomination would be disenfranchisement by
          mailing-list preference. Note that delivery and open tracking is not currently recording
          anything, so treat &ldquo;sent&rdquo; as &ldquo;attempted&rdquo;; whether a nomination is
          progressing is the reliable signal.
        </p>
      </section>

      <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">As things stand</h2>
        <p className="mt-1 text-sm text-gray-600">{projected.reason}</p>
        <p className="mt-2 text-xs text-gray-500">
          This is a projection from what would count today, not a decision. It settles on{" "}
          {formatDate(election.schedule.nominationsCloseAt)} when nominations close.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">
              Nominees ({nominations.length})
            </h2>
            {incomplete.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {incomplete.length} accepted but still missing something — these are the ones to
                chase before {formatDate(election.schedule.nominationsCloseAt)}.
              </p>
            )}
          </div>

          {nominations.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-500">
              No nominations yet. The call goes out{" "}
              {formatDate(election.schedule.nominationsOpenAt)}.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {nominations.map((n) => (
                <li key={n.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{n.nomineeName}</p>
                      <p className="text-sm text-gray-600">{n.organizationName}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {n.source === "nominating_committee" ? "Committee slate" : "Member nomination"}
                        {" · "}
                        {n.cosignatures.required > 0
                          ? `${n.cosignatures.valid}/${n.cosignatures.required} signatures`
                          : "no signatures required"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        n.completeness.complete
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {n.completeness.complete ? "Ready" : "Incomplete"}
                    </span>
                  </div>

                  {!n.completeness.complete && (
                    <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
                      {n.completeness.missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}

                  {/* Directors co-signing is permitted — every CSC director is
                      also an org admin — but it belongs on the record. */}
                  {n.cosignatures.signedByDirectors.length > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      {n.cosignatures.signedByDirectors.length} signature
                      {n.cosignatures.signedByDirectors.length === 1 ? "" : "s"} from sitting
                      directors.
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    {n.withdrawalRequestedAt ? (
                      <span className="text-xs text-gray-500">
                        Withdrawal asked {formatDate(n.withdrawalRequestedAt)} — awaiting the
                        nominee&apos;s decision.
                      </span>
                    ) : (
                      <form action={askToWithdraw}>
                        <input type="hidden" name="nominationId" value={n.id} />
                        <button
                          type="submit"
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Ask if they would withdraw
                        </button>
                      </form>
                    )}
                    <Link
                      href={`/elections/accept/${n.acceptToken}`}
                      className="text-xs text-gray-500 underline hover:text-gray-700"
                    >
                      View their page
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <RepresentationPanel snapshot={representation} />
      </div>
    </div>
  );
}
