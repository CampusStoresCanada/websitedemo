/**
 * Board vote standing for a partner application, shown on the admin review
 * screen so staff can see whether the board has spoken before approving.
 *
 * A carried vote is the cue to press approve — Butler never provisions
 * anything itself.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callBoardVoteAgain } from "@/lib/actions/applications";
import { formatTally, type Tally, type VoteStatus } from "@/lib/board/vote-tally";
import { formatCloseLabel } from "@/lib/board/vote-schedule";

export interface BoardVoteSummary {
  voteId: string;
  applicationId: string;
  status: VoteStatus;
  closesAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  circlePostUrl: string | null;
  tally: Tally;
}

const STYLES: Record<VoteStatus, { label: string; className: string }> = {
  open: { label: "Vote open", className: "bg-blue-50 text-blue-800 border-blue-200" },
  carried: { label: "Approved by the board", className: "bg-green-50 text-green-800 border-green-200" },
  rejected: { label: "Not approved", className: "bg-red-50 text-red-800 border-red-200" },
  lapsed: { label: "No decision", className: "bg-amber-50 text-amber-900 border-amber-200" },
  withdrawn: { label: "Withdrawn", className: "bg-gray-50 text-gray-700 border-gray-200" },
};

export function BoardVoteStatus({ vote }: { vote: BoardVoteSummary }) {
  const style = STYLES[vote.status];

  return (
    <div className={`rounded-lg border p-3 text-sm ${style.className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{style.label}</span>
        <span className="opacity-70">·</span>
        <span>{formatTally(vote.tally)}</span>
      </div>

      <div className="mt-1 text-xs opacity-80">
        {vote.status === "open"
          ? `Closes ${formatCloseLabel(new Date(vote.closesAt))}`
          : `Closed ${formatCloseLabel(new Date(vote.closesAt))}`}
        {vote.circlePostUrl && (
          <>
            {" · "}
            <a
              href={vote.circlePostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Discussion in Board Stuff
            </a>
          </>
        )}
      </div>

      {vote.status === "carried" && !vote.executedAt && (
        <p className="mt-2 text-xs font-medium">
          Ready to approve — nothing is provisioned until you do.
        </p>
      )}

      {vote.status === "lapsed" && (
        <>
          <p className="mt-2 text-xs">
            Voting closed without reaching the threshold either way. This carries to the next board
            meeting; it is not a decline.
          </p>
          <CallVoteAgainButton applicationId={vote.applicationId} />
        </>
      )}
    </div>
  );
}

/**
 * Butler never asks the board twice on its own, so after a lapse this is the
 * only way back in front of them. It posts to the board, so it confirms first.
 */
function CallVoteAgainButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call() {
    setBusy(true);
    setError(null);
    const result = await callBoardVoteAgain(applicationId);
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? "Could not open the vote.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="mt-2 text-xs">
      {confirming ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>This posts a new vote to the board.</span>
          <button
            type="button"
            onClick={call}
            disabled={busy}
            className="rounded-md bg-amber-900 px-2 py-1 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Opening..." : "Open the vote"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="underline">
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium"
        >
          Call the vote again
        </button>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
