"use client";

import { useMemo, useState, useTransition } from "react";
import type { PartnerAsk, CircleState } from "@/lib/comms/partner-asks";

/**
 * One row as this screen needs it.
 *
 * ⚠️ Deliberately NOT `PartnerCandidate`. That type belongs to the retired word
 * matcher, which still exists only as the baseline in the A/B harness, and
 * sharing a row shape with it is how the two engines would quietly become
 * interchangeable again.
 *
 * ⛔ Carries `rank`, never a similarity. Raw cosine here is 0.33–0.41 across the
 * whole list — printing it invites an operator to read a 0.35 as "35% sure",
 * which it is not. Position is the only part of the number that means anything
 * to a human, so position is the only part shown.
 */
export interface AskPanelCandidate {
  contactId: string | null;
  orgId: string;
  name: string;
  email: string;
  orgName: string;
  circleState: CircleState;
  rank: number;
  reasons: string[];
  /** Null means they have never spoken in Circle — the reason they are here. */
  lastSpokeAt: string | null;
  /** We picked this person from the org; the engine ranked the company. */
  viaOrgContact: boolean;
  /** A verdict already recorded for this suggestion, if any. */
  verdict: Verdict | null;
}

export type Verdict = "good" | "bad" | "unsure";

/**
 * ⛔ Rating is NOT the checkbox, and the two must stay separate acts.
 *
 * Ticking someone means "email them"; a rating means "the engine was right about
 * them". They come apart constantly — an operator sends to a mediocre match to
 * fill out a thin list, or skips a perfect one because they wrote to them last
 * week. Reading selection as approval would quietly label both of those wrong,
 * in the one table we use to decide whether the engine works.
 */
const VERDICTS: { value: Verdict; label: string; on: string; hint: string }[] = [
  { value: "good", label: "Good", on: "bg-green-600 text-white border-green-600",
    hint: "This partner could genuinely answer this question." },
  { value: "bad", label: "Wrong", on: "bg-red-600 text-white border-red-600",
    hint: "The engine misread the question, or misread this partner." },
  // ⚠️ Offered deliberately. Without it a hesitant human picks a confident
  // answer, and the evaluation treats a shrug as certainty.
  { value: "unsure", label: "?", on: "bg-gray-600 text-white border-gray-600",
    hint: "Genuine uncertainty — recorded, and counted neither way." },
];

const STATE_STYLE: Record<CircleState, { label: string; cls: string; hint: string }> = {
  active: {
    label: "Active",
    cls: "bg-green-100 text-green-700",
    hint: "In Circle and has completed setup — will see this today.",
  },
  invited: {
    label: "Invited",
    cls: "bg-yellow-100 text-yellow-700",
    hint: "Has a Circle account but never finished signing up.",
  },
  absent: {
    label: "Not in Circle",
    cls: "bg-gray-100 text-gray-600",
    hint: "No Circle account — the sign-in link will not work for them yet.",
  },
};

export default function PartnerAskPanel({
  ask,
  candidates,
  scored,
  filtered,
  action,
  onJudge,
}: {
  ask: PartnerAsk;
  candidates: AskPanelCandidate[];
  /** Records a verdict on one suggestion. Never sends anything. */
  onJudge: (
    orgId: string, contactId: string | null, rank: number, verdict: Verdict
  ) => Promise<{ ok: boolean }>;
  /** False = the nightly run has not reached this ask. Not the same as empty. */
  scored: boolean;
  /** Ranked, but hidden by the audience filter (already active, or a member). */
  filtered: number;
  action: (formData: FormData) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c = { active: 0, invited: 0, absent: 0 } as Record<CircleState, number>;
    for (const x of candidates) c[x.circleState]++;
    return c;
  }, [candidates]);

  const toggle = (email: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [judgeFailed, setJudgeFailed] = useState<Record<string, true>>({});
  const [, startJudging] = useTransition();

  const judge = (c: AskPanelCandidate, verdict: Verdict) => {
    setVerdicts((p) => ({ ...p, [c.email]: verdict }));
    setJudgeFailed((p) => { const n = { ...p }; delete n[c.email]; return n; });
    startJudging(async () => {
      const res = await onJudge(c.orgId, c.contactId, c.rank, verdict);
      // ⚠️ Roll back a verdict that did not land. A button left coloured shows a
      // rating that exists nowhere, and the evaluation would be missing exactly
      // the rows a human believes they recorded.
      if (!res.ok) {
        setVerdicts((p) => { const n = { ...p }; delete n[c.email]; return n; });
        setJudgeFailed((p) => ({ ...p, [c.email]: true }));
      }
    });
  };

  const pickedCandidates = candidates.filter((c) => picked.has(c.email));
  const pickedAbsent = pickedCandidates.filter((c) => c.circleState === "absent").length;

  return (
    <div className="space-y-6">
      {/* The ask */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{ask.title}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {ask.askerName}
              {ask.askerOrg ? ` · ${ask.askerOrg}` : ""}
              {ask.publishedAt ? ` · ${new Date(ask.publishedAt).toLocaleDateString()}` : ""}
            </p>
          </div>
          <a
            href={ask.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-sm text-red-600 hover:underline"
          >
            View in Circle ↗
          </a>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{ask.excerpt}</p>
      </div>

      {/* Candidates */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-3">
          <h3 className="font-medium text-gray-900">
            {candidates.length} partner{candidates.length === 1 ? "" : "s"} worth emailing
            {filtered > 0 && (
              <span className="ml-2 font-normal text-xs text-gray-500">
                {filtered} more ranked, hidden — already active in Circle, or not a partner
              </span>
            )}
          </h3>
          <div className="flex gap-2 text-xs">
            {(["active", "invited", "absent"] as CircleState[]).map((s) => (
              <span key={s} className={`rounded px-2 py-0.5 ${STATE_STYLE[s].cls}`}>
                {counts[s]} {STATE_STYLE[s].label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        {candidates.length === 0 ? (
          // ⚠️ Two different facts, two different sentences. Collapsing them into
          // one "no matches" is what makes an operator wait for a list that is
          // never coming, or build a manual one the engine could have filled.
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            {!scored ? (
              <>
                <strong className="text-gray-700">Not scored yet.</strong> Questions are
                ranked overnight, so one posted today is ready tomorrow morning.
              </>
            ) : filtered > 0 ? (
              <>
                <strong className="text-gray-700">Everyone who fits is already here.</strong>{" "}
                All {filtered} ranked partners are active in Circle — they will see this
                question without an email.
              </>
            ) : (
              <>
                <strong className="text-gray-700">Nobody ranked for this one.</strong> It may
                need a manual list.
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {candidates.map((c) => {
              const st = STATE_STYLE[c.circleState];
              return (
                <li key={c.email} className="flex items-start gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-red-600"
                    checked={picked.has(c.email)}
                    onChange={() => toggle(c.email)}
                    id={`r-${c.email}`}
                  />
                  <label htmlFor={`r-${c.email}`} className="min-w-0 flex-1 cursor-pointer">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <span className="text-sm text-gray-500">· {c.orgName}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${st.cls}`} title={st.hint}>
                        {st.label}
                      </span>
                      {c.viaOrgContact && (
                        <span
                          className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
                          title="The engine matched this company, not this person. We picked their listed contact — check they are the right one to ask."
                        >
                          org contact
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-400">#{c.rank}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      {c.email}
                      <span className="ml-2 text-gray-400">
                        {c.lastSpokeAt
                          ? `last spoke ${new Date(c.lastSpokeAt).toLocaleDateString()}`
                          : "never spoken in Circle"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-400">{c.reasons.join(" · ")}</div>
                  </label>
                  {/*
                    Outside the <label>, so rating never toggles the checkbox —
                    a stray click that silently adds a recipient is the one
                    mistake this screen must not make.
                  */}
                  <div className="mt-1 flex shrink-0 items-center gap-1">
                    {VERDICTS.map((v) => {
                      const current = verdicts[c.email] ?? c.verdict;
                      return (
                        <button
                          key={v.value}
                          type="button"
                          title={v.hint}
                          onClick={() => judge(c, v.value)}
                          className={`rounded border px-1.5 py-0.5 text-xs transition ${
                            current === v.value
                              ? v.on
                              : "border-gray-300 text-gray-500 hover:border-gray-400"
                          }`}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                    {judgeFailed[c.email] && (
                      <span className="text-xs text-red-600">not saved</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Prepare — copy comes from the partner_ask_invite template */}
      <form action={action} className="rounded-lg border border-gray-200 bg-white p-5">
        <input type="hidden" name="ask_id" value={ask.id} />
        <input type="hidden" name="ask_title" value={ask.title} />
        <input type="hidden" name="ask_excerpt" value={ask.excerpt} />
        <input type="hidden" name="ask_url" value={ask.url} />
        <input type="hidden" name="asker_name" value={ask.askerName} />
        <input type="hidden" name="asker_org" value={ask.askerOrg ?? ""} />
        {pickedCandidates.map((c) => (
          <input key={c.email} type="hidden" name="recipient" value={`${c.email}|${c.name}`} />
        ))}
        {/*
          Who the operator actually picked, by id, so the choice can be recorded
          against what the engine suggested. Carried separately from `recipient`
          because that one is an email/name pair the campaign needs, and ids are
          what the feedback loop needs — squeezing both through one field is how
          the log would start disagreeing with the send.

          ⛔ Sent at the grain the ENGINE used, which is why `viaOrgContact` blanks
          the contact id. For an org-grain recommendation the stored row has no
          contact, and writing back the person WE attached at read time would miss
          it — logging a candidate the engine ranked #6 as `recommended: false`,
          the marker reserved for one a human added that we never surfaced. That
          would not be a lost row; it would be a fabricated miss, in the one table
          used to judge whether the engine works, biasing it against itself. The
          person emailed is not lost — the campaign holds them.
          See [[feedback_downstream_of_our_own_decision]].
        */}
        {pickedCandidates.map((c) => (
          <input
            key={`pick-${c.email}`}
            type="hidden"
            name="pick"
            value={`${c.orgId}|${c.viaOrgContact ? "" : (c.contactId ?? "")}`}
          />
        ))}

        <p className="text-sm text-gray-700">
          Uses the <strong>Partner Ask — Invite to Answer</strong> template. Edit the wording in{" "}
          <a href="/admin/comms/templates" className="text-red-600 hover:underline">
            Templates
          </a>{" "}
          — it applies to every future send, no deploy needed.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          This ask fills in: <code>ask_title</code>, <code>ask_excerpt</code>, <code>ask_url</code>,{" "}
          <code>asker_name</code>, <code>asker_org_suffix</code>. The sign-in button uses{" "}
          <code>{"{{app_url}}"}/api/circle/member-space</code>, which mints a fresh Circle session on
          each click — never a pre-minted token, which would expire before most people open the mail.
        </p>

        {pickedAbsent > 0 && (
          <p className="mt-3 rounded bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            {pickedAbsent} selected partner{pickedAbsent === 1 ? " has" : "s have"} no Circle
            account. The sign-in link won&apos;t work for them until they&apos;re provisioned.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {picked.size} recipient{picked.size === 1 ? "" : "s"} selected
          </span>
          <button
            type="submit"
            disabled={picked.size === 0}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Prepare send →
          </button>
        </div>
        <p className="mt-2 text-right text-xs text-gray-400">
          Creates a draft campaign and opens it for review. Nothing sends from this screen.
        </p>
      </form>
    </div>
  );
}
