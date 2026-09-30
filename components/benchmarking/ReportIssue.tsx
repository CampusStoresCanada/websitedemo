"use client";

import { useState } from "react";
import { reportIssue } from "@/lib/actions/benchmarking-issues";
import BusyButton from "./BusyButton";

/**
 * "This question is wrong", said where the question is.
 *
 * The beta invitation asks people to tell us afterwards what they had to guess
 * at. Afterwards is the problem: by the time somebody writes that email they
 * are describing a question they met an hour ago, in words that no longer point
 * at it. This carries the section with it, so a reviewer can go and look.
 *
 * ⛔ Never argues and never validates. "I do not understand what you mean by
 * this" is the most valuable thing a store can tell us and the least likely
 * thing it will say if the box pushes back. It also does not block: reporting a
 * problem is not a reason to stop filling the survey in.
 */
export default function ReportIssue({
  benchmarkingId,
  sectionId,
  sectionTitle,
}: {
  benchmarkingId: string;
  sectionId: string;
  sectionTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <p className="mt-6 text-xs text-green-700">
        Thank you. That is with the committee, along with which section you were on.{" "}
        <button
          onClick={() => {
            setSent(false);
            setBody("");
          }}
          className="underline"
        >
          Report something else
        </button>
      </p>
    );
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-gray-500 underline underline-offset-4 hover:text-[#163D6D]"
        >
          Something wrong with this section? Tell us
        </button>
      ) : (
        <div className="max-w-xl">
          <label className="block text-sm font-medium text-gray-900">
            What went wrong in {sectionTitle}?
          </label>
          <p className="mt-1 text-xs text-gray-600">
            A question that does not fit how your store reports, a figure you had to
            guess at, wording you read two ways, anything broken. We send it to the
            committee with the section attached. Nothing here changes your answers.
          </p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            aria-label={`Report a problem with ${sectionTitle}`}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex items-center gap-3">
            <BusyButton
              busyLabel="Sending…"
              disabled={!body.trim()}
              onClick={async () => {
                const res = await reportIssue({ benchmarkingId, sectionId, body });
                if (!res.success) {
                  setError(res.error ?? "Could not send that.");
                  return;
                }
                setSent(true);
                setOpen(false);
                setError(null);
              }}
              className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
            >
              Send to the committee
            </BusyButton>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="text-xs text-gray-600 underline"
            >
              Cancel
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
