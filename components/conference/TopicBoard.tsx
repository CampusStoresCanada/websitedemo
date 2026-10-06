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
  voteClosesLabel = null,
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
  /** e.g. "Friday, December 11" — when the members' vote closes. */
  voteClosesLabel?: string | null;
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
      <h2 className="text-lg font-semibold text-gray-900">What people want to talk about</h2>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        {canVote
          ? "Choose all the topics that appeal to you, or none. We aren't picking on votes alone and we might combine topics. If you pick one, be ready to help us host it — we'd love you at the table, you don't need to prepare anything."
          : "Member stores choose which of these run on the day."}
      </p>

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
                    <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                      {topic.votes}
                    </span>
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
            None of these appeal to me
          </button>
          {status === "saving" ? <span className="text-gray-500">Saving…</span> : null}
          {status === "saved" ? (
            <span className="text-green-700">
              {chosen.length === 0 ? "Noted — none of these." : `Saved: ${chosen.length} chosen.`}
            </span>
          ) : null}
          {status === "idle" && voted && chosen.length === 0 ? (
            <span className="text-gray-500">You picked none of these.</span>
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
          Topics are in by <strong>{deadlineLabel}</strong>. Member stores vote the
          following week{voteClosesLabel ? `, closing ${voteClosesLabel}` : ""}, we announce
          what is running straight after, and any deposit on a topic that is not picked
          comes back then.
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
