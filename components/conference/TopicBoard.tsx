"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { proposeTopic, saveTopicBallot, type TopicChip } from "@/lib/actions/conference-topics";

/**
 * The Big Ideas Day topic board: everything proposed, and what this member
 * picked out of it.
 *
 * Member topics and partner topics sit in one list on purpose — they are
 * chosen between under the same rules, so separating them would tell a reader
 * the choice is not really open.
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
}) {
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

        ⛔ "Vote" is avoided as a NOUN throughout. It promises a count that
        wins, which is exactly what this is not — a topic can take every pick
        and still not run. "Pick" and "choose" instead.
      */}
      <h2 className="text-lg font-semibold text-gray-900">What gets talked about is up to you</h2>
      {canVote ? (
        <div className="mt-2 max-w-2xl space-y-3 text-sm leading-relaxed text-gray-600">
          <p>
            The topics below come from members and from partners, all in one list. Pick the
            ones you&apos;d want to sit at. Pick all of them. Pick none, if nothing&apos;s
            landed yet, and come back later, because people keep adding and the list in
            December won&apos;t be the list today.
          </p>
          <p>If something&apos;s missing, add it. That&apos;s rather the point.</p>
          <p>
            Picking a topic isn&apos;t a ballot and it isn&apos;t binding on us. We
            aren&apos;t choosing on votes alone, we might fold two topics together when
            they&apos;re really the same conversation, and we&apos;ll place things so the
            day holds together. What your picks do is tell us what people actually want to
            spend an hour on, which is the thing we can&apos;t guess from here.
          </p>
          <p>
            One thing worth knowing before you pick. If you choose a topic, be ready to sit
            at that table on the day. You don&apos;t need to prepare anything, bring slides,
            or have the answer. Just turn up and talk.
          </p>
          <p className="text-gray-500">
            Change your mind as often as you like. Nothing&apos;s final until we publish the
            day.
          </p>
        </div>
      ) : (
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          The topics below come from members and from partners, all in one list. Member
          stores pick the ones they want to sit at.
        </p>
      )}

      {topics.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          No topics yet. {canPropose ? "Put the first one forward." : ""}
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {topics.map((topic) => {
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
          Pitch a session with a $250 deposit by <strong>{deadlineLabel}</strong>. Member
          stores pick the following week, we announce what is running straight after, and
          any deposit on a topic that is not picked comes back then.
        </p>
      ) : null}

      {canPropose ? (
        <ProposeTopicForm
          conferenceId={conferenceId}
          organizationId={organizationId!}
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
}: {
  conferenceId: string;
  organizationId: string;
  deadlineLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
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
        <input value={title} onChange={(e) => setTitle(e.target.value)} required className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-700">What would you want to get into?</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={inputClass} />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add this topic"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">
          Cancel
        </button>
        {deadlineLabel ? (
          <span className="text-xs text-gray-500">Topics close {deadlineLabel}.</span>
        ) : null}
      </div>
    </form>
  );
}
