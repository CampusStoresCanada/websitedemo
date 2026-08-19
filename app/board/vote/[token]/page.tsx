/**
 * /board/vote/[token] — where Butler's Circle buttons land.
 *
 * The vote URL is shared by all nine directors (a Circle post is one document
 * everyone sees), so the voter is identified by their session, never by the
 * link. `?choice=` records immediately, which is safe precisely because a
 * session is required: an unfurler or prefetcher has no session and cannot
 * cast anything.
 *
 * Deliberately says nothing about recusal or conflicts of interest — Abstain is
 * offered as one of three plain options and left to speak for itself.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import { getVoteByToken, castBallot } from "@/lib/board/vote-service";
import { formatTally, type VoteChoice } from "@/lib/board/vote-tally";
import { formatCloseLabel } from "@/lib/board/vote-schedule";

export const dynamic = "force-dynamic";

const CHOICES: Array<{ value: VoteChoice; label: string; className: string }> = [
  { value: "yes", label: "Vote Yes", className: "bg-[#B92026] hover:bg-[#9c1b20] text-white" },
  { value: "no", label: "Vote No", className: "bg-[#2B2E33] hover:bg-[#1a1d21] text-white" },
  { value: "abstain", label: "Abstain", className: "bg-[#6B7280] hover:bg-[#565d68] text-white" },
];

function isChoice(value: unknown): value is VoteChoice {
  return value === "yes" || value === "no" || value === "abstain";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

export default async function BoardVotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ choice?: string }>;
}) {
  const { token } = await params;
  const { choice } = await searchParams;

  const auth = await getServerAuthState();
  if (!auth.user) {
    // `next`, not `redirect` — LoginForm reads `next` and silently falls back to
    // "/" for anything else. Carrying the choice through means a director who
    // clicks "Vote Yes" in Circle, logs in, and lands back here has their vote
    // recorded by that original click rather than having to find the button again.
    const returnTo = `/board/vote/${token}${choice ? `?choice=${choice}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }

  const state = await getVoteByToken(token, auth.user.id);
  if (!state) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900">Vote not found</h1>
        <p className="mt-2 text-gray-600">
          That link doesn&apos;t match an open board vote. It may have been superseded.
        </p>
      </Shell>
    );
  }

  // Record before rendering, so the page reflects the click that got us here.
  let error: string | null = null;
  if (isChoice(choice)) {
    const result = await castBallot(token, auth.user.id, choice);
    if (!result.ok) error = result.error;
    else redirect(`/board/vote/${token}`); // drop ?choice so a refresh doesn't re-cast
  }

  const fresh = await getVoteByToken(token, auth.user.id);
  const { vote, companyName, tally, myChoice, deadlinePassed } = fresh ?? state;
  const closed = vote.status !== "open" || deadlinePassed;

  const isDirector = auth.globalRole === "admin";

  return (
    <Shell>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Campus Stores Canada · Board vote
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900">{companyName}</h1>
      <p className="mt-1 text-sm text-gray-600">Vendor Partner application</p>

      {error && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </div>
      )}

      {myChoice && !error && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-900">
            Your vote is recorded: <strong>{myChoice === "abstain" ? "Abstain" : myChoice.toUpperCase()}</strong>
          </p>
          {!closed && (
            <p className="mt-1 text-sm text-green-800">
              You can change it until voting closes.
            </p>
          )}
        </div>
      )}

      {!closed && isDirector && (
        <div className="mt-6 space-y-2">
          {!myChoice && (
            <p className="text-sm text-gray-700">Should we approve this partner?</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {CHOICES.map((c) => (
              <Link
                key={c.value}
                href={`/board/vote/${token}?choice=${c.value}`}
                prefetch={false}
                className={`flex-1 rounded-md px-4 py-2.5 text-center text-sm font-semibold transition ${c.className} ${
                  myChoice === c.value ? "ring-2 ring-offset-2 ring-gray-400" : ""
                }`}
              >
                {myChoice && myChoice !== c.value ? `Change to ${c.label.replace("Vote ", "")}` : c.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isDirector && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          Only sitting board directors can vote on partner applications. You can still see where
          the vote stands.
        </div>
      )}

      <dl className="mt-8 space-y-2 border-t border-gray-200 pt-6 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Standing</dt>
          <dd className="text-right font-medium text-gray-900">{formatTally(tally)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">{closed ? "Closed" : "Closes"}</dt>
          <dd className="text-right text-gray-900">
            {formatCloseLabel(new Date(vote.closes_at))}
          </dd>
        </div>
      </dl>

      {vote.circle_post_url && (
        <p className="mt-6 text-sm">
          <a
            href={vote.circle_post_url}
            className="font-medium text-[#B92026] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Back to the discussion in Board Stuff →
          </a>
        </p>
      )}
    </Shell>
  );
}
