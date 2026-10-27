"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCircleSpaceRule, deleteCircleSpaceRule } from "@/lib/actions/circle-space-rules";
import type { RuleLastRun } from "@/lib/circle/space-rules";
import { parseUTC } from "@/lib/utils";

export type SpaceRuleView = {
  id: string;
  spaceId: number;
  spaceName: string | null;
  label: string;
  kind: string;
  conferenceId: string | null;
  passEntityIds: string[] | null;
  surveyField: string | null;
  surveyValue: string | null;
  lastRun: RuleLastRun | null;
  lastRunAt: string | null;
};

type Props = {
  rules: SpaceRuleView[];
  spaces: { id: number; name: string; isPrivate: boolean }[];
  spacesError: string | null;
  conferences: { id: string; name: string }[];
  passes: { id: string; conferenceId: string; name: string }[];
  surveyFields: { field: string; label: string }[];
  surveyAnswers: Record<string, string[]>;
};

type Draft = {
  id: string | null;
  spaceId: string;
  label: string;
  kind: "conference_passes" | "survey_answer";
  conferenceId: string;
  allPasses: boolean;
  passEntityIds: string[];
  surveyField: string;
  surveyValue: string;
};

const inputClass =
  "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]";

function emptyDraft(): Draft {
  return {
    id: null,
    spaceId: "",
    label: "",
    kind: "conference_passes",
    conferenceId: "",
    allPasses: true,
    passEntityIds: [],
    surveyField: "pos_system",
    surveyValue: "",
  };
}

function draftFrom(r: SpaceRuleView): Draft {
  return {
    id: r.id,
    spaceId: String(r.spaceId),
    label: r.label,
    kind: r.kind === "survey_answer" ? "survey_answer" : "conference_passes",
    conferenceId: r.conferenceId ?? "",
    allPasses: r.passEntityIds == null,
    passEntityIds: r.passEntityIds ?? [],
    surveyField: r.surveyField ?? "pos_system",
    surveyValue: r.surveyValue ?? "",
  };
}

function LastRun({ rule }: { rule: SpaceRuleView }) {
  if (!rule.lastRunAt || !rule.lastRun) return <span className="text-gray-400">Not run yet</span>;
  const when = parseUTC(rule.lastRunAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  if (rule.lastRun.error) {
    return (
      <span className="text-red-700">
        {rule.lastRun.error}
        <span className="block text-xs text-gray-400" suppressHydrationWarning>{when}</span>
      </span>
    );
  }
  const r = rule.lastRun;
  return (
    <span className="text-gray-700">
      {r.holders ?? 0} qualify · {r.inSpace ?? 0} in space · {r.waitingOnInvite ?? 0} waiting on invite
      {(r.noCircleAccount ?? 0) > 0 && <> · {r.noCircleAccount} no Circle account</>}
      {((r.queuedAdds ?? 0) > 0 || (r.queuedRemoves ?? 0) > 0) && (
        <> · {r.queuedAdds ?? 0} added, {r.queuedRemoves ?? 0} removed</>
      )}
      <span className="block text-xs text-gray-400" suppressHydrationWarning>{when}</span>
    </span>
  );
}

export default function SpaceRulesClient(props: Props) {
  const { rules, spaces, spacesError, conferences, passes, surveyFields, surveyAnswers } = props;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const confName = new Map(conferences.map((c) => [c.id, c.name]));
  const passName = new Map(passes.map((p) => [p.id, p.name]));
  const fieldLabel = new Map(surveyFields.map((f) => [f.field, f.label]));
  const takenSpaces = new Set(rules.filter((r) => r.id !== draft?.id).map((r) => r.spaceId));

  function describe(r: SpaceRuleView): string {
    if (r.kind === "survey_answer") {
      return `Current-member schools whose latest survey answer to "${fieldLabel.get(r.surveyField ?? "") ?? r.surveyField}" includes "${r.surveyValue}"`;
    }
    const conf = confName.get(r.conferenceId ?? "") ?? "a conference";
    if (!r.passEntityIds) return `Anyone holding a pass to ${conf}`;
    const names = r.passEntityIds.map((id) => passName.get(id) ?? "an unknown pass");
    return `${conf} holders of: ${names.join(", ")}`;
  }

  function save() {
    if (!draft) return;
    setError(null);
    startSave(async () => {
      const result = await saveCircleSpaceRule(draft.id, {
        spaceId: Number(draft.spaceId),
        label: draft.label,
        kind: draft.kind,
        conferenceId: draft.conferenceId || null,
        passEntityIds: draft.allPasses ? null : draft.passEntityIds,
        surveyField: draft.surveyField,
        surveyValue: draft.surveyValue,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function remove(r: SpaceRuleView) {
    if (!confirm(`Stop syncing "${r.label}"? People already in the space stay in it.`)) return;
    setError(null);
    startSave(async () => {
      const result = await deleteCircleSpaceRule(r.id);
      if (!result.success) setError(result.error);
      else router.refresh();
    });
  }

  const confPasses = draft ? passes.filter((p) => p.conferenceId === draft.conferenceId) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Rules</h2>
            <p className="text-xs text-gray-500 mt-0.5">One rule per space. Changes apply on the next hourly run.</p>
          </div>
          {!draft && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setDraft(emptyDraft());
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Add rule
            </button>
          )}
        </div>
        {rules.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">No spaces are synced yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Space</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Who belongs</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 min-w-[14rem]">Last run</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.label}</div>
                    <div className="text-xs text-gray-500">
                      {r.spaceName ?? "Circle space"} · {r.spaceId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{describe(r)}</td>
                  <td className="px-4 py-3">
                    <LastRun rule={r} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setError(null);
                        setDraft(draftFrom(r));
                      }}
                      className="text-xs font-medium text-[#163D6D] hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => remove(r)}
                      className="ml-3 text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && !draft && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {draft && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">{draft.id ? "Edit rule" : "New rule"}</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Circle space</label>
              {draft.id ? (
                <p className="text-sm text-gray-700 py-2">
                  {spaces.find((s) => s.id === Number(draft.spaceId))?.name ?? "Circle space"} · {draft.spaceId}
                  <span className="block text-xs text-gray-500">
                    To use a different space, remove this rule and add a new one.
                  </span>
                </p>
              ) : spaces.length > 0 ? (
                <select
                  value={draft.spaceId}
                  onChange={(e) => {
                    const name = spaces.find((s) => String(s.id) === e.target.value)?.name ?? "";
                    setDraft({ ...draft, spaceId: e.target.value, label: draft.label || name });
                  }}
                  className={inputClass}
                >
                  <option value="">Pick a space…</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id} disabled={takenSpaces.has(s.id)}>
                      {s.name}
                      {s.isPrivate ? "" : " (public)"}
                      {takenSpaces.has(s.id) ? " (has a rule)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    value={draft.spaceId}
                    onChange={(e) => setDraft({ ...draft, spaceId: e.target.value.replace(/\D/g, "") })}
                    placeholder="Circle space id"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-amber-700">
                    Could not list Circle spaces{spacesError ? `: ${spacesError}` : ""}. Enter the space id instead.
                  </p>
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="e.g. Members Only"
                className={inputClass}
              />
            </div>
          </div>

          <fieldset>
            <legend className="block text-xs font-medium text-gray-700 mb-1">Who belongs in the space</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.kind === "conference_passes"}
                  onChange={() => setDraft({ ...draft, kind: "conference_passes" })}
                />
                Conference pass holders
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.kind === "survey_answer"}
                  onChange={() => setDraft({ ...draft, kind: "survey_answer" })}
                />
                Schools by benchmarking answer
              </label>
            </div>
          </fieldset>

          {draft.kind === "conference_passes" ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Conference</label>
                <select
                  value={draft.conferenceId}
                  onChange={(e) => setDraft({ ...draft, conferenceId: e.target.value, passEntityIds: [] })}
                  className={inputClass}
                >
                  <option value="">Pick a conference…</option>
                  {conferences.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {draft.conferenceId && (
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.allPasses}
                      onChange={(e) => setDraft({ ...draft, allPasses: e.target.checked })}
                    />
                    Every pass, including ones added later
                  </label>
                  {!draft.allPasses && (
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {confPasses.length === 0 && (
                        <p className="text-xs text-gray-500">This conference has no passes yet.</p>
                      )}
                      {confPasses.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={draft.passEntityIds.includes(p.id)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                passEntityIds: e.target.checked
                                  ? [...draft.passEntityIds, p.id]
                                  : draft.passEntityIds.filter((x) => x !== p.id),
                              })
                            }
                          />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Survey question</label>
                <select
                  value={draft.surveyField}
                  onChange={(e) => setDraft({ ...draft, surveyField: e.target.value, surveyValue: "" })}
                  className={inputClass}
                >
                  {surveyFields.map((f) => (
                    <option key={f.field} value={f.field}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Answer includes</label>
                <select
                  value={draft.surveyValue}
                  onChange={(e) => setDraft({ ...draft, surveyValue: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Pick an answer…</option>
                  {(surveyAnswers[draft.surveyField] ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <p className="sm:col-span-2 text-xs text-gray-500">
                Every contact at a current-member school whose most recent submitted survey includes this answer.
              </p>
            </div>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save rule"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
