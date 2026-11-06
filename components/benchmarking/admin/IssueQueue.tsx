"use client";

import { useState } from "react";
import { decideSurveyFlag, type SurveyFlag } from "@/lib/actions/benchmarking-flags";
import BusyButton from "@/components/benchmarking/BusyButton";

/**
 * What respondents said was wrong, and what was done about it.
 *
 * ⛔ Ordered open-first and never auto-closed. A report that nobody answered is
 * the expensive one: the store that wrote it learns that telling us costs
 * effort and changes nothing, and the next thing it does with a question it
 * cannot answer is guess.
 */

/** The site-wide flag statuses, not a benchmarking-only set. */
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  dismissed: "Not a problem",
};

/**
 * Where to send somebody to see the question a report was about.
 *
 * ⛔ The RESPONDENT's submission, at the field, not a generic copy of the form.
 * The point of following a report is seeing the figure that provoked it in the
 * state that store left it in, so `?org=` names their store — the same pin
 * /benchmarking/compare and the worksheet use — and `#field-` lands on the
 * question.
 *
 * ⛔ Bare /benchmarking/survey, which is what this linked to, opens the
 * READER's own store instead: a committee member following it landed in their
 * own institution's form rather than the one being reported on.
 *
 * Opening another store does not write. resolveActingOrg marks the viewer
 * isActingAsOther and the survey page then refuses to create a draft row, so a
 * store that had not started is not started by being looked at.
 *
 * Without the org we cannot pin it, and sending them to their own form would be
 * worse than sending them nowhere — so the card drops the link and says why.
 */
function whereTheyWere(issue: SurveyFlag): string | null {
  if (!issue.pageUrl.startsWith("/benchmarking/survey")) return issue.pageUrl;
  if (!issue.organizationId) return null;
  const anchor = issue.fieldKey ? `#field-${issue.fieldKey}` : "";
  return `/benchmarking/survey?org=${issue.organizationId}${anchor}`;
}

export default function IssueQueue({
  issues,
  focusId,
}: {
  issues: SurveyFlag[];
  /**
   * The one report a Butler notification was about, from `?flag=<id>`.
   *
   * ⛔ Three notifications used to land on the same unordered list, so there was
   * no way to tell which row any of them meant. This brings it to the top of its
   * group and rings it.
   */
  focusId?: string | null;
}) {
  const [rows, setRows] = useState(issues);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The notified row first within its own group. Deliberately NOT lifted out of
  // its group: a resolved report jumping above the open ones would misreport the
  // state of the queue to make one link tidy.
  const first = (a: SurveyFlag, b: SurveyFlag) =>
    Number(b.id === focusId) - Number(a.id === focusId);
  /*
    ⛔ "acknowledged" counted as dealt with, because the split was `status ===
    "open"` against everything else. So a report somebody had merely picked up
    was filed under Dealt with with no decision recorded against it, and the
    Open count under-reported what was actually outstanding. Acknowledged means
    a person has it, not that it is finished.
  */
  const outstanding = rows
    .filter((r) => r.status === "open" || r.status === "acknowledged")
    .sort(first);
  const closed = rows
    .filter((r) => r.status === "resolved" || r.status === "dismissed")
    .sort(first);

  async function decide(
    issue: SurveyFlag,
    status: "open" | "acknowledged" | "resolved" | "dismissed",
  ) {
    const res = await decideSurveyFlag({
      flagId: issue.id,
      status,
      resolutionNotes: note,
    });
    if (!res.success) {
      setError(res.error ?? "Could not save that.");
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === issue.id ? { ...r, status, resolutionNotes: note.trim() || null } : r,
      ),
    );
    setEditing(null);
    setNote("");
    setError(null);
  }

  const card = (issue: SurveyFlag) => (
    <li
      key={issue.id}
      id={`flag-${issue.id}`}
      className={`rounded-lg border bg-white p-4 ${
        issue.id === focusId
          ? "border-[#163D6D] ring-2 ring-[#163D6D]/20"
          : "border-gray-200"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {issue.organizationName ?? "Unknown store"}
          </p>
          <p className="text-xs text-gray-500">
            {issue.section ?? "No section recorded"}
            {issue.flaggerName ? ` · ${issue.flaggerName}` : ""}
            {issue.priority === "high" ? " · urgent" : ""}
          </p>
          {/*
            The field they were standing on. ⛔ The one thing that tells two
            reports from the same store on the same section apart, and it was
            already on the row, unread.
          */}
          {issue.fieldKey && (
            <p className="mt-0.5 font-mono text-[11px] text-gray-400">
              {issue.fieldKey}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            issue.status === "open"
              ? "bg-amber-100 text-amber-900"
              : issue.status === "acknowledged"
                ? "bg-blue-100 text-blue-900"
                : "bg-gray-100 text-gray-600"
          }`}
        >
          {STATUS_LABEL[issue.status] ?? issue.status}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-line text-sm text-gray-800">
        {issue.note ?? "No description given."}
      </p>
      {whereTheyWere(issue) ? (
        <a
          href={whereTheyWere(issue)!}
          className="mt-1 inline-block text-xs text-[#163D6D] underline underline-offset-4"
        >
          Go to where they were
        </a>
      ) : (
        <p className="mt-1 text-xs text-gray-400">
          No store on this report, so there is no submission to open.
        </p>
      )}

      {/*
        ⛔ resolved_by and resolved_at have been written by decideSurveyFlag
        since it shipped and displayed nowhere, so the queue could say a report
        was resolved and not who resolved it or when. That is the whole question
        a second responder asks before touching it.
      */}
      {issue.status !== "open" && (issue.resolvedByName || issue.resolvedAt) && (
        <p className="mt-2 text-xs text-gray-500">
          {STATUS_LABEL[issue.status] ?? issue.status}
          {issue.resolvedByName ? ` by ${issue.resolvedByName}` : ""}
          {issue.resolvedAt
            ? ` on ${new Date(issue.resolvedAt).toLocaleDateString("en-CA", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}`
            : ""}
        </p>
      )}

      {issue.resolutionNotes && (
        <p className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-700">
          <span className="font-medium">What we did: </span>
          {issue.resolutionNotes}
        </p>
      )}

      {editing === issue.id ? (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What did we do about it? The store does not see this."
            aria-label="Resolution note"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {(["acknowledged", "resolved", "dismissed"] as const).map((s) => (
              <BusyButton
                key={s}
                onClick={() => decide(issue, s)}
                className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#163D6D]"
              >
                {STATUS_LABEL[s]}
              </BusyButton>
            ))}
            <button
              onClick={() => {
                setEditing(null);
                setNote("");
              }}
              className="text-xs text-gray-500 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setEditing(issue.id);
            setNote(issue.resolutionNotes ?? "");
          }}
          className="mt-2 text-xs text-[#163D6D] underline underline-offset-4"
        >
          {issue.status === "open" ? "Decide" : "Change"}
        </button>
      )}
    </li>
  );

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      <h2 className="text-sm font-semibold text-gray-900">
        Outstanding ({outstanding.length})
      </h2>
      {outstanding.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          Nothing outstanding. That is either very good news or nobody has been asked to
          fill the survey yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">{outstanding.map(card)}</ul>
      )}

      {closed.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-gray-900">
            Dealt with ({closed.length})
          </h2>
          <ul className="mt-3 space-y-3">{closed.map(card)}</ul>
        </>
      )}
    </div>
  );
}
