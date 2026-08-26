"use client";

import { useMemo, useState } from "react";
import type {
  FieldConfig,
  SurveyFieldConfig,
} from "@/lib/benchmarking/default-field-config";
import { saveFieldReview } from "@/lib/actions/benchmarking-review";

type ReviewStatus = "pending" | "ok" | "ambiguous" | "needs_example";

interface ExistingReview {
  id: string;
  field_name: string;
  status: ReviewStatus;
  comment: string | null;
  proposed_example: string | null;
  proposed_example_credit: string | null;
  proposed_help_text: string | null;
  resolution: string;
}

export interface PeerComment {
  reviewerName: string;
  status: string;
  comment: string | null;
  proposedExample: string | null;
  proposedExampleCredit: string | null;
}

interface Props {
  surveyId: string;
  surveyTitle: string;
  fiscalYear: number;
  reviewerName: string;
  fieldConfig: SurveyFieldConfig;
  existingReviews: ExistingReview[];
  /** Peers' notes, keyed by field — only present for fields you have answered. */
  peerComments: Record<string, PeerComment[]>;
  /** How many peers have answered each field, whether or not you can see them yet. */
  peerCounts: Record<string, number>;
  /**
   * Show the real thing to someone deciding whether to take this on.
   * Nothing saves. Steve can send a link instead of describing it down a phone.
   */
  preview?: boolean;
}

interface Draft {
  status: ReviewStatus;
  comment: string;
  proposedExample: string;
  proposedExampleCredit: string;
  proposedHelpText: string;
  saved: boolean;
  savedOnce?: boolean;
  saving: boolean;
  error: string | null;
}

const EMPTY: Draft = {
  status: "pending",
  comment: "",
  proposedExample: "",
  proposedExampleCredit: "",
  proposedHelpText: "",
  saved: false,
  saving: false,
  error: null,
};

export default function FieldReviewWorkspace({
  surveyId,
  surveyTitle,
  fiscalYear,
  reviewerName,
  fieldConfig,
  existingReviews,
  peerComments,
  peerCounts,
  preview = false,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  // Flatten config into reviewable fields, keeping the section for context.
  const allFields = useMemo(() => {
    const out: { section: string; field: FieldConfig }[] = [];
    for (const section of [...fieldConfig.sections].sort(
      (a, b) => a.order - b.order,
    )) {
      for (const field of [...section.fields].sort(
        (a, b) => a.order - b.order,
      )) {
        if (field.calculated || field.displayOnly) continue;
        out.push({ section: section.title, field });
      }
    }
    return out;
  }, [fieldConfig]);

  const flagged = useMemo(
    () => allFields.filter((f) => f.field.reviewerNote),
    [allFields],
  );
  const visible = showAll ? allFields : flagged;

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const seed: Record<string, Draft> = {};
    for (const r of existingReviews) {
      seed[r.field_name] = {
        status: r.status,
        comment: r.comment ?? "",
        proposedExample: r.proposed_example ?? "",
        proposedExampleCredit: r.proposed_example_credit ?? "",
        proposedHelpText: r.proposed_help_text ?? "",
        saved: true,
        savedOnce: true,
        saving: false,
        error: null,
      };
    }
    return seed;
  });

  const draftFor = (name: string) => drafts[name] ?? EMPTY;

  const update = (name: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({
      ...prev,
      [name]: { ...draftFor(name), ...patch, saved: false },
    }));

  const save = async (name: string) => {
    const d = draftFor(name);
    if (preview) {
      // Let them click it and see it acknowledge, without writing anything.
      setDrafts((prev) => ({
        ...prev,
        [name]: { ...prev[name], saved: true, savedOnce: true, saving: false },
      }));
      return;
    }
    update(name, { saving: true, error: null });
    const result = await saveFieldReview(surveyId, name, {
      status: d.status === "pending" ? "ok" : d.status,
      comment: d.comment,
      proposedExample: d.proposedExample,
      proposedExampleCredit: d.proposedExampleCredit,
      proposedHelpText: d.proposedHelpText,
    });
    setDrafts((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        saving: false,
        saved: result.success,
        savedOnce: prev[name]?.savedOnce || result.success,
        error: result.success ? null : (result.error ?? "Could not save"),
      },
    }));
  };

  const doneCount = flagged.filter(
    (f) =>
      drafts[f.field.name]?.saved || drafts[f.field.name]?.status !== undefined,
  ).length;
  const savedCount = flagged.filter((f) => {
    const d = drafts[f.field.name];
    return d && d.status !== "pending";
  }).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
          {surveyTitle} &middot; FY{fiscalYear}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Where will these questions be misread?
        </h1>
        <p className="text-sm text-gray-600 mb-2">
          Hello {reviewerName}. Below are the questions that caused the most
          trouble last year. For each one: tell us whether the wording holds up,
          and if you can, write the example — &ldquo;for us this is $X, which
          includes A and B but not C.&rdquo;
        </p>
        <p className="text-sm text-gray-600">
          Made-up numbers are completely fine. It is the shape of the answer
          that matters, not your actual figures. If you only get through six,
          send us six.
        </p>
      </header>

      {preview && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            This is a look around, not the real thing.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Everything works — click a verdict, open a question, type an
            example. Nothing is saved and nobody sees it. If you decide to take
            this on, you get the same screen with your name on it.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-200">
        <p className="text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{savedCount}</span> of{" "}
          {flagged.length} answered
        </p>
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
        >
          {showAll
            ? `Just the ${flagged.length} that bit us`
            : `Show all ${allFields.length} questions`}
        </button>
      </div>

      <div className="space-y-5">
        {visible.map(({ section, field }) => (
          <FieldCard
            key={field.name}
            section={section}
            field={field}
            draft={draftFor(field.name)}
            peers={peerComments[field.name] ?? []}
            peerCount={peerCounts[field.name] ?? 0}
            onChange={(patch) => update(field.name, patch)}
            onSave={() => save(field.name)}
          />
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-12">
          Nothing flagged for review on this survey.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function FieldCard({
  section,
  field,
  draft,
  peers,
  peerCount,
  onChange,
  onSave,
}: {
  section: string;
  field: FieldConfig;
  draft: Draft;
  peers: PeerComment[];
  peerCount: number;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const answered = draft.status !== "pending";
  // Distinct from `answered`: a verdict is selected the instant you click one,
  // but the row only exists once it has been written.
  const hasSaved = draft.saved || Boolean(draft.savedOnce);

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        answered ? "border-gray-200" : "border-gray-300"
      }`}
    >
      <div className="p-4 bg-white">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
              {section}
            </p>
            <h3 className="text-base font-semibold text-gray-900">
              {field.label}
            </h3>
          </div>
          {answered && (
            <span className="shrink-0 text-[11px] font-medium px-2 py-1 rounded bg-green-50 text-green-700">
              {draft.saved ? "Saved" : "Unsaved"}
            </span>
          )}
        </div>

        {/* What the respondent will read */}
        {field.helpText && (
          <p className="text-sm text-gray-600 mt-2">{field.helpText}</p>
        )}
        {field.example && (
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Current example
              {field.exampleCredit ? ` · ${field.exampleCredit}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-700">{field.example}</p>
          </div>
        )}

        {/* Why this field is on the list */}
        {field.reviewerNote && (
          <div className="mt-3 rounded border-l-2 border-amber-400 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
              What happened last year
            </p>
            <p className="mt-1 text-xs text-amber-900">{field.reviewerNote}</p>
          </div>
        )}

        {/* Verdict */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ["ok", "Reads fine"],
              ["ambiguous", "Could be misread"],
              ["needs_example", "Needs an example"],
            ] as [ReviewStatus, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                onChange({ status: value });
                setOpen(true);
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
                draft.status === value
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-medium text-gray-500 hover:text-gray-900 px-2 py-1.5"
          >
            {open
              ? "Hide"
              : answered
                ? "Revise your answer"
                : "Add example or note"}
          </button>
        </div>

        {answered && !open && (draft.proposedExample || draft.comment) && (
          <div className="mt-3 rounded border border-gray-200 bg-white px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Your answer
            </p>
            {draft.proposedExample && (
              <p className="mt-1 text-xs text-gray-700">
                {draft.proposedExample}
              </p>
            )}
            {draft.comment && (
              <p className="mt-1 text-xs text-gray-500">{draft.comment}</p>
            )}
          </div>
        )}

        {/* Peers. Held back until you have answered, so your first read is your own. */}
        {peerCount > 0 && !answered && (
          <p className="mt-3 text-xs text-gray-400 italic">
            {peerCount} other reviewer{peerCount === 1 ? " has" : "s have"}{" "}
            answered this one. Give your own verdict and their notes appear.
          </p>
        )}

        {peers.length > 0 && answered && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
              What other reviewers said
            </p>
            <div className="space-y-2">
              {peers.map((p, i) => (
                <div key={i} className="rounded bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-800">
                      {p.reviewerName}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        p.status === "ok"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {p.status === "ok"
                        ? "Reads fine"
                        : p.status === "ambiguous"
                          ? "Could be misread"
                          : "Needs an example"}
                    </span>
                  </div>
                  {p.comment && (
                    <p className="text-xs text-gray-700">{p.comment}</p>
                  )}
                  {p.proposedExample && (
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-medium">Their example: </span>
                      {p.proposedExample}
                      {p.proposedExampleCredit
                        ? ` (${p.proposedExampleCredit})`
                        : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {!open && (
              <button
                onClick={() => setOpen(true)}
                className="mt-2 text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
              >
                Changed your mind? Revise your answer
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Your worked example
            </label>
            <textarea
              rows={2}
              value={draft.proposedExample}
              onChange={(e) => onChange({ proposedExample: e.target.value })}
              placeholder="For us this is $X, which includes A and B but not C."
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Credit your store? (optional)
            </label>
            <input
              type="text"
              value={draft.proposedExampleCredit}
              onChange={(e) =>
                onChange({ proposedExampleCredit: e.target.value })
              }
              placeholder="Leave blank and it goes in unattributed"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Rewrite the explanation, if ours is wrong
            </label>
            <textarea
              rows={2}
              value={draft.proposedHelpText}
              onChange={(e) => onChange({ proposedHelpText: e.target.value })}
              placeholder="Leave blank to keep the wording above"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Anything else we should know
            </label>
            <textarea
              rows={2}
              value={draft.comment}
              onChange={(e) => onChange({ comment: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          {draft.error && <p className="text-xs text-red-600">{draft.error}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={onSave}
              disabled={draft.saving}
              className="text-xs font-medium px-4 py-2 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {draft.saving ? "Saving…" : hasSaved ? "Update" : "Save"}
            </button>
            {draft.saved && (
              <span className="text-xs text-green-700">Saved</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
