"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { proposeTopic, saveTopicBallot, type TopicChip } from "@/lib/actions/conference-topics";
import GreyBlur from "@/components/ui/GreyBlur";

/**
 * The Big Ideas Day topic board: everything proposed, and what this member
 * picked out of it.
 *
 * Two headed lists over ONE board. A partner's pitch is a formal presentation
 * in one room; a member's is an informal table conversation in another (Steve,
 * 2026-11-20). Under one heading the page told members to "sit at" a talk.
 *
 * ⛔ The split is a heading, not a second system. Both lists are the same
 * chips, the same picks and the same ballot, so the choice is still open
 * across all of it. What decides the list is who proposed it, which is the
 * line the deposit already draws: partners pay to pitch a presentation,
 * members pay nothing to put a table forward.
 */
export default function TopicBoard({
  conferenceId,
  organizationId,
  topics,
  hasBallot,
  canVote,
  canPropose,
  proposeBlockedReason,
  deadlineLabel,
  tablesRoom,
  talksRoom,
  presentationMinutes,
  signedOut,
}: {
  conferenceId: string;
  organizationId: string | null;
  topics: TopicChip[];
  hasBallot: boolean;
  canVote: boolean;
  canPropose: boolean;
  proposeBlockedReason: string | null;
  /** e.g. "Friday, December 4" — the date pitches have to be in by. */
  deadlineLabel: string | null;
  /** Room names off the schedule. Null until the build workspace names one. */
  tablesRoom: string | null;
  talksRoom: string | null;
  presentationMinutes: number;
  /**
   * A signed-out reader sees each list, then that list's own way in, greyed
   * out behind a sign-in. The site's one greyed-out pattern (GreyBlur), over
   * the real form rather than a drawing of one.
   */
  signedOut: boolean;
}) {
  const presentations = topics.filter((t) => t.orgType === "Vendor Partner");
  const tables = topics.filter((t) => t.orgType !== "Vendor Partner");
  const groups = [
    {
      key: "presentations",
      heading: "Presentations",
      // The whole difference, said where the choice is made (Steve approved
      // this wording 2026-11-20). Formal vs informal, who proposes, what it
      // costs, and what choosing one does.
      about:
        `A partner presents for ${presentationMinutes} minutes${talksRoom ? ` in ${talksRoom}` : ""}, ` +
        `then stays in the room for questions. Partners pitch these with a $250 deposit` +
        `${deadlineLabel ? ` by ${deadlineLabel}` : ""}. Members vote on which ones run.`,
      empty: "No presentations pitched yet.",
      signInMessage: "Sign in to pitch a presentation or vote on one.",
      topics: presentations,
    },
    {
      key: "tables",
      heading: "Table conversations",
      about:
        `An informal conversation around a table${tablesRoom ? ` in ${tablesRoom}` : ""}. ` +
        `No slides and no presenter. Any member can put one forward, and it costs nothing. ` +
        `Pick the ones you'd sit at.`,
      empty: "No table conversations put forward yet.",
      signInMessage: "Sign in to put a topic forward for discussion.",
      topics: tables,
    },
  ];
  const [chosen, setChosen] = useState<string[]>(topics.filter((t) => t.chosen).map((t) => t.id));
  const [voted, setVoted] = useState(hasBallot);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  /**
   * ⛔ THE SAVE BELONGS TO THE CLICK, NEVER TO AN EFFECT WATCHING `chosen`.
   *
   * React double-invokes effects in development, so a save-on-change effect
   * would fire on mount with the initial value. For MeetingPreferencesEditor
   * that destroyed a saved choice. Here it would be worse: an empty array is
   * the real answer "none of these", so a stray mount write would silently
   * convert "has not voted" into "read them all and wanted none".
   *
   * Debounced from the handler instead. Mounting writes nothing at all.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string[] | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function queueSave(next: string[]) {
    if (!organizationId) return;
    pending.current = next;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const attempt = pending.current;
      if (!attempt) return;
      const result = await saveTopicBallot({ conferenceId, organizationId, topicIds: attempt });
      if (pending.current !== attempt) return; // superseded
      if (!result.success) {
        setError(result.error);
        setStatus("idle");
        return;
      }
      setError(null);
      setVoted(true);
      setStatus("saved");
    }, 500);
  }

  function toggle(topicId: string) {
    setChosen((current) => {
      const next = current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId];
      queueSave(next);
      return next;
    });
  }

  return (
    <section className="mt-10">
      {/*
        Copy owned by the page-writing session: see
        planning/town-hall-followup/05-big-ideas-day-page-copy.md. Changes to
        wording go through there, so the page and the five invitation emails
        stay in step.

        ⛔ Two verbs, one per list (Steve, 2026-11-20: "Vote on
        presentations"). A presentation carries a deposit that comes back if
        it is not chosen, so members VOTE on those. A table conversation is
        still a PICK: a signal, not a count that wins, and a table can take
        every pick and still not run. Do not let "vote" leak onto the tables.
      */}
      <h2 className="text-lg font-semibold text-gray-900">What gets talked about is up to you</h2>
      {canVote ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
          {/* The longer explanation lives under "How it works" at the foot of the page. */}
          Vote for the presentations you want to see and pick the table conversations
          you&apos;d want to sit at. Choose as many as you like, and if something&apos;s
          missing, add it.
        </p>
      ) : (
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          The topics below come from members and from partners. Partners pitch
          presentations and members put forward table conversations. Member stores vote
          on the presentations and pick the table conversations they want to sit at.
        </p>
      )}

      {topics.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          No topics yet. {canPropose ? "Put the first one forward." : ""}
        </p>
      ) : (
        groups.map((group) => (
        <div key={group.key} className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900">{group.heading}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">{group.about}</p>
          {group.topics.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">{group.empty}</p>
          ) : null}
        <ul className="mt-2 space-y-2">
          {group.topics.map((topic) => {
            const picked = chosen.includes(topic.id);
            const Chip = canVote ? "button" : "div";
            return (
              <li key={topic.id}>
                <Chip
                  {...(canVote ? { type: "button" as const, onClick: () => toggle(topic.id) } : {})}
                  aria-pressed={canVote ? picked : undefined}
                  className={`block w-full rounded-xl border p-4 text-left transition ${
                    picked
                      ? "border-[#EE2A2E] bg-[#fff1f1]"
                      : "border-gray-200 bg-white" + (canVote ? " hover:border-gray-400" : "")
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{topic.title}</p>
                      {topic.body ? (
                        <p className="mt-1 text-sm leading-relaxed text-gray-600">{topic.body}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-gray-400">Proposed by {topic.orgName}</p>
                    </div>
                    {/*
                      ⛔ No count rendered, deliberately. "No count shown, no
                      deadline on picking, no limit, no sense of a thing you can
                      get wrong — it's a signal, not a poll." A visible tally
                      turns picking into a leaderboard and quietly promises that
                      the top one runs, which is the promise we cannot keep.
                      `topic.votes` still comes back for staff, who do need it.
                    */}
                  </div>
                </Chip>
              </li>
            );
          })}
        </ul>
          {signedOut ? (
            <div className="mt-3 overflow-hidden rounded-xl">
              <GreyBlur
                requiredPermission="partner"
                unauthorizedMessage={group.signInMessage}
                ctaText="Sign In"
                ctaLink="/login"
              >
                <ProposeTopicForm conferenceId={conferenceId} organizationId={null} deadlineLabel={null} preview />
              </GreyBlur>
            </div>
          ) : null}
        </div>
        ))
      )}

      {canVote ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          {/*
            "None of these" is an explicit act, not the absence of one. Clicking
            it writes a ballot with zero selections, which is how a member who
            read the list and wanted none of it is told apart from a member who
            never opened the page.
          */}
          <button
            type="button"
            onClick={() => { setChosen([]); queueSave([]); }}
            className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
          >
            Nothing here for me yet
          </button>
          {status === "saving" ? <span className="text-gray-500">Saving…</span> : null}
          {status === "saved" ? (
            <span className="text-green-700">
              {chosen.length === 0 ? "Noted — nothing here yet." : `Saved: ${chosen.length} picked.`}
            </span>
          ) : null}
          {status === "idle" && voted && chosen.length === 0 ? (
            <span className="text-gray-500">You haven&apos;t picked any of these.</span>
          ) : null}
          {error ? <span className="text-red-700">{error}</span> : null}
        </div>
      ) : null}

      {/*
        The whole sequence, where someone is deciding whether to pitch.
        A partner is handing over a deposit to enter this; "refunded if not
        selected" without dates asks them to take the timing on trust, and the
        invitation emails carry exactly these dates.
      */}
      {deadlineLabel ? (
        <p className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
          Pitch a presentation with a $250 deposit by <strong>{deadlineLabel}</strong>. Member
          stores vote the following week, we announce what is running straight after, and
          any deposit on a presentation that is not chosen comes back then.
        </p>
      ) : null}

      {canPropose ? (
        <ProposeTopicForm
          conferenceId={conferenceId}
          organizationId={organizationId}
          deadlineLabel={deadlineLabel}
        />
      ) : proposeBlockedReason ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {proposeBlockedReason}
        </p>
      ) : null}
    </section>
  );
}

function ProposeTopicForm({
  conferenceId,
  organizationId,
  deadlineLabel,
  preview = false,
}: {
  conferenceId: string;
  /** Null only in preview, where nothing can be submitted. */
  organizationId: string | null;
  deadlineLabel: string | null;
  /** The form as a signed-out reader sees it behind GreyBlur: open, and inert. */
  preview?: boolean;
}) {
  const [open, setOpen] = useState(preview);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <p className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        Topic added. It's in the list above for members to choose from.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
      >
        Don&apos;t see yours? Put a topic forward
      </button>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]";

  return (
    <form
      className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (preview || !organizationId) return;
        setError(null);
        startTransition(async () => {
          const result = await proposeTopic({ conferenceId, organizationId, title, body });
          if (!result.success) return setError(result.error);
          setDone(true);
        });
      }}
    >
      <label className="block">
        <span className="text-sm font-medium text-gray-700">Topic</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required disabled={preview} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">What would you want to get into?</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} disabled={preview} className={inputClass} />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || preview}
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add this topic"}
        </button>
        <button type="button" disabled={preview} onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">
          Cancel
        </button>
        {deadlineLabel ? (
          <span className="text-xs text-gray-500">Topics close {deadlineLabel}.</span>
        ) : null}
      </div>
    </form>
  );
}
