"use client";

import { useMemo, useState } from "react";
import type { PartnerAsk, PartnerCandidate, CircleState } from "@/lib/comms/partner-asks";

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
  action,
}: {
  ask: PartnerAsk;
  candidates: PartnerCandidate[];
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
            {candidates.length} matching partner{candidates.length === 1 ? "" : "s"}
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
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            No partner categories matched this question. It may need a manual list.
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
                      <span className="ml-auto text-xs text-gray-400">score {c.score}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">{c.email}</div>
                    <div className="mt-1 text-xs text-gray-400">{c.reasons.join(" · ")}</div>
                  </label>
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
