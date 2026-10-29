"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCircleSpaceRule, deleteCircleSpaceRule } from "@/lib/actions/circle-space-rules";
import type { RuleLastRun } from "@/lib/circle/space-rules";
import { parseUTC } from "@/lib/utils";

export type SpaceRuleView = {
  id: string;
  /** Null on a rule whose destination is not a Circle space. */
  spaceId: number | null;
  spaceName: string | null;
  destination: string;
  googleGroupEmail: string | null;
  bodyKey: string | null;
  roleKey: string | null;
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
  bodies: { key: string; name: string }[];
  /** Body key → the roles people actually hold on it. */
  rolesByBody: Record<string, string[]>;
};

type RuleKind = "conference_passes" | "survey_answer" | "governance_role";

type Draft = {
  id: string | null;
  spaceId: string;
  label: string;
  kind: RuleKind;
  googleGroupEmail: string;
  bodyKey: string;
  roleKey: string;
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
    googleGroupEmail: "",
    bodyKey: "",
    roleKey: "",
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
    spaceId: r.spaceId === null ? "" : String(r.spaceId),
    label: r.label,
    kind:
      r.kind === "survey_answer"
        ? "survey_answer"
        : r.kind === "governance_role"
          ? "governance_role"
          : "conference_passes",
    googleGroupEmail: r.googleGroupEmail ?? "",
    bodyKey: r.bodyKey ?? "",
    roleKey: r.roleKey ?? "",
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
  // ⚠️ A group run fills the same counters, but two of these words would be
  // false about it: there is no space and no invite to wait on. A group add or
  // removal happens at the press and is confirmed by a read back, so both
  // counters here are things that DID happen, not things queued.
  if (rule.destination === "google_group") {
    return (
      <span className="text-gray-700">
        {r.holders ?? 0} hold the role · {r.inSpace ?? 0} in the group
        {(r.queuedAdds ?? 0) > 0 && <> · {r.queuedAdds} added</>}
        {(r.queuedRemoves ?? 0) > 0 && <> · {r.queuedRemoves} taken off</>}
        <span className="block text-xs text-gray-400" suppressHydrationWarning>{when}</span>
      </span>
    );
  }
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
  const { rules, spaces, spacesError, conferences, passes, surveyFields, surveyAnswers, bodies, rolesByBody } =
    props;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const confName = new Map(conferences.map((c) => [c.id, c.name]));
  const passName = new Map(passes.map((p) => [p.id, p.name]));
  const fieldLabel = new Map(surveyFields.map((f) => [f.field, f.label]));
  const takenSpaces = new Set(
    rules.filter((r) => r.id !== draft?.id && r.spaceId !== null).map((r) => r.spaceId as number),
  );

  const bodyName = new Map(bodies.map((b) => [b.key, b.name]));

  function describe(r: SpaceRuleView): string {
    if (r.kind === "governance_role") {
      const body = bodyName.get(r.bodyKey ?? "") ?? r.bodyKey ?? "a body";
      return `Everyone currently holding "${r.roleKey}" on the ${body}`;
    }
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
      // The kind decides the destination: a role rule keeps a Google group in
      // step, everything else a Circle space. Nobody has to pick twice, and a
      // combination the database would refuse cannot be expressed.
      const isRole = draft.kind === "governance_role";
      const result = await saveCircleSpaceRule(draft.id, {
        spaceId: isRole ? null : Number(draft.spaceId),
        label: draft.label,
        kind: draft.kind,
        destination: isRole ? "google_group" : "circle_space",
        googleGroupEmail: isRole ? draft.googleGroupEmail : null,
        bodyKey: isRole ? draft.bodyKey : null,
        roleKey: isRole ? draft.roleKey : null,
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
  const isRoleRule = draft?.kind === "governance_role";
  // Only roles someone actually holds: a list of every role a body could have
  // would offer rules that match nobody.
  const roleChoices = draft ? (rolesByBody[draft.bodyKey] ?? []) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Rules</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              One rule per space or group. Changes apply on the next hourly run.
            </p>
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
                <th className="px-4 py-2 text-left font-medium text-gray-600">Destination</th>
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
                      {r.destination === "google_group"
                        ? (r.googleGroupEmail ?? "Google group")
                        : `${r.spaceName ?? "Circle space"} · ${r.spaceId}`}
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
            {draft.kind === "governance_role" ? (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Google group</label>
                {draft.id ? (
                  <p className="text-sm text-gray-700 py-2">
                    {draft.googleGroupEmail || "Google group"}
                    <span className="block text-xs text-gray-500">
                      To use a different group, remove this rule and add a new one.
                    </span>
                  </p>
                ) : (
                  <input
                    value={draft.googleGroupEmail}
                    onChange={(e) => setDraft({ ...draft, googleGroupEmail: e.target.value })}
                    placeholder="board@campusstores.ca"
                    className={inputClass}
                  />
                )}
                <p className="mt-1 text-xs text-gray-500">
                  People are added, never removed. Taking someone off the group stays a manual step.
                </p>
              </div>
            ) : (
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
            )}
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
            <legend className="block text-xs font-medium text-gray-700 mb-1">Who belongs</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.kind === "conference_passes"}
                  onChange={() => setDraft({ ...draft, kind: "conference_passes" })}
                  disabled={isRoleRule && draft.id !== null}
                />
                Conference pass holders
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.kind === "survey_answer"}
                  onChange={() => setDraft({ ...draft, kind: "survey_answer" })}
                  disabled={isRoleRule && draft.id !== null}
                />
                Schools by benchmarking answer
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={isRoleRule}
                  onChange={() => setDraft({ ...draft, kind: "governance_role" })}
                  disabled={!isRoleRule && draft.id !== null}
                />
                People holding a governance role
              </label>
            </div>
            {draft.id !== null && (
              <p className="mt-1 text-xs text-gray-500">
                A saved rule keeps its destination. To send the same people somewhere else, add a second rule.
              </p>
            )}
          </fieldset>

          {isRoleRule ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Body</label>
                <select
                  value={draft.bodyKey}
                  onChange={(e) => setDraft({ ...draft, bodyKey: e.target.value, roleKey: "" })}
                  className={inputClass}
                >
                  <option value="">Pick a body…</option>
                  {bodies.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={draft.roleKey}
                  onChange={(e) => setDraft({ ...draft, roleKey: e.target.value })}
                  disabled={!draft.bodyKey}
                  className={inputClass}
                >
                  <option value="">{draft.bodyKey ? "Pick a role…" : "Pick a body first"}</option>
                  {roleChoices.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                {draft.bodyKey && roleChoices.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    Nobody holds a role on this body yet, so there is nothing to pick. Fill the roster first.
                  </p>
                )}
              </div>
              <p className="sm:col-span-2 text-xs text-gray-500">
                Everyone holding this role today, at their institutional address. Personal addresses are left alone.
              </p>
            </div>
          ) : draft.kind === "conference_passes" ? (
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
