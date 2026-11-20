"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeTopic, type StaffTopic, type StaffTopicBoard } from "@/lib/actions/conference-topics";

/**
 * Big Ideas Day pitches, on the admin Schedule page: what members chose, and
 * staff deciding what runs.
 *
 * The same shape as the travel bursary queue (a list of requests, a decision
 * per row), sitting with the schedule because placing a pitch IS scheduling
 * it. The store was already there: status, time and table on each pitch.
 *
 * ⛔ No "approve" press. A presentation runs by being given a time, a table
 * conversation by being given a table; picking the time is the decision.
 */

const inputClass =
  "rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent";
const quietButton =
  "rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50";

export default function BigIdeasPitchesPanel({ board, fixtures }: { board: StaffTopicBoard; fixtures: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function place(topicId: string, input: Omit<Parameters<typeof placeTopic>[0], "topicId">) {
    setBusyId(topicId);
    setError(null);
    const result = await placeTopic({ topicId, ...input });
    setBusyId(null);
    if (!result.success) return setError(result.error);
    startTransition(() => router.refresh());
  }

  const live = board.topics.filter((t) => t.status !== "withdrawn");
  const presentations = live.filter((t) => t.presentation);
  const tables = live.filter((t) => !t.presentation);
  const taken = new Map(
    presentations.filter((t) => t.status === "scheduled" && t.startTime).map((t) => [t.startTime!, t.id])
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Big Ideas Day pitches</h2>
        <p className="text-xs text-gray-500">
          {[board.dayLabel, `${board.ballots} ${board.ballots === 1 ? "member has" : "members have"} chosen`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {fixtures ? (
        <p className="mx-4 mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing test pitches only. Nothing here reaches the public page.
        </p>
      ) : null}

      {error ? (
        <p className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}

      <Group
        heading="Presentations"
        where={board.talksRoom}
        empty="No presentations pitched yet."
        topics={presentations}
        tally="vote"
        renderControls={(topic) => (
          <select
            aria-label={`Time for ${topic.title}`}
            className={inputClass}
            disabled={busyId === topic.id || board.slots.length === 0}
            value={topic.status === "scheduled" ? (topic.startTime ?? "") : ""}
            onChange={(e) =>
              e.target.value
                ? place(topic.id, { decision: "run", startTime: e.target.value })
                : place(topic.id, { decision: "undecide" })
            }
          >
            <option value="">Not running</option>
            {board.slots.map((slot) => {
              const holder = taken.get(slot.value);
              return (
                <option key={slot.value} value={slot.value} disabled={Boolean(holder && holder !== topic.id)}>
                  {slot.label}
                  {holder && holder !== topic.id ? " (taken)" : ""}
                </option>
              );
            })}
          </select>
        )}
        busyId={busyId}
        onPlace={place}
      />

      <Group
        heading="Table conversations"
        where={board.tablesRoom}
        empty="No table conversations put forward yet."
        topics={tables}
        tally="pick"
        renderControls={(topic) => <TableControls topic={topic} busy={busyId === topic.id} onPlace={place} />}
        busyId={busyId}
        onPlace={place}
      />

      <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500">
        Members see a running pitch with its time or table on the Big Ideas Day page, and a declined
        one drops off it. Declining does not refund a deposit; refund it from the partner&apos;s order.
      </p>
    </div>
  );
}

type Place = (topicId: string, input: Omit<Parameters<typeof placeTopic>[0], "topicId">) => void;

function Group({
  heading,
  where,
  empty,
  topics,
  tally,
  renderControls,
  busyId,
  onPlace,
}: {
  heading: string;
  where: string | null;
  empty: string;
  topics: StaffTopic[];
  tally: "vote" | "pick";
  renderControls: (topic: StaffTopic) => React.ReactNode;
  busyId: string | null;
  onPlace: Place;
}) {
  // Most-chosen first: the order staff read it in. Declined sink to the foot.
  const ordered = [...topics].sort(
    (a, z) =>
      Number(a.status === "declined") - Number(z.status === "declined") ||
      z.votes - a.votes ||
      // A stable order for ties, or rows trade places under the cursor on every refresh.
      a.title.localeCompare(z.title)
  );
  return (
    <div className="px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {heading}
        {where ? <span className="ml-2 font-normal normal-case tracking-normal">{where}</span> : null}
      </h3>
      {ordered.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {ordered.map((topic) => (
            <li key={topic.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
              <div className={`min-w-0 flex-1 ${topic.status === "declined" ? "opacity-50" : ""}`}>
                <p className="text-sm font-medium text-gray-900">{topic.title}</p>
                <p className="text-xs text-gray-500">
                  {topic.orgName}
                  {topic.presentation
                    ? topic.hasDeposit
                      ? " · deposit on record"
                      : " · no deposit on record"
                    : ""}
                </p>
              </div>
              <span className="w-20 shrink-0 text-right text-sm tabular-nums text-gray-700">
                {topic.votes} {topic.votes === 1 ? tally : `${tally}s`}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {topic.status === "declined" ? (
                  <>
                    <span className="text-xs text-gray-500">Declined</span>
                    <button
                      type="button"
                      className={quietButton}
                      disabled={busyId === topic.id}
                      onClick={() => onPlace(topic.id, { decision: "undecide" })}
                    >
                      Undo
                    </button>
                  </>
                ) : (
                  <>
                    {renderControls(topic)}
                    <button
                      type="button"
                      className={quietButton}
                      disabled={busyId === topic.id}
                      onClick={() => onPlace(topic.id, { decision: "decline" })}
                    >
                      Decline
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A table conversation runs by being given a table; the time is optional. */
function TableControls({ topic, busy, onPlace }: { topic: StaffTopic; busy: boolean; onPlace: Place }) {
  const [label, setLabel] = useState(topic.tableLabel ?? "");
  const [time, setTime] = useState(topic.startTime ?? "");
  const running = topic.status === "scheduled";
  const changed = label.trim() !== (topic.tableLabel ?? "") || time !== (topic.startTime ?? "");
  return (
    <>
      <input
        aria-label={`Table for ${topic.title}`}
        className={`${inputClass} w-24`}
        placeholder="Table"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        aria-label={`Time for ${topic.title}`}
        type="time"
        className={inputClass}
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />
      <button
        type="button"
        className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        disabled={busy || !label.trim() || (running && !changed)}
        onClick={() => onPlace(topic.id, { decision: "run", tableLabel: label, startTime: time || null })}
      >
        {running ? "Update" : "Running"}
      </button>
      {running ? (
        <button
          type="button"
          className={quietButton}
          disabled={busy}
          onClick={() => onPlace(topic.id, { decision: "undecide" })}
        >
          Not running
        </button>
      ) : null}
    </>
  );
}
