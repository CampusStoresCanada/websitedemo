"use client";

import { useEffect, useState } from "react";
import { createSchedulerDraftRun, emailActiveSchedule, loadMeetingsOverview, promoteSchedulerRun, type MeetingsOverview } from "@/lib/actions/conference-scheduler";
import MeetingMatrix from "@/components/admin/conference/MeetingMatrix";
import Modal from "@/components/ui/Modal";
import OperateRow from "@/components/ui/OperateRow";

import { plural, whenMountain } from "./shared";

/** What a scheduler run's diagnostics say, in an operator's words. */
const FINDING_WORDS: Record<string, string> = {
  BLACKOUT: "Put someone in a meeting with an organization they refused",
  DUPLICATE_EXHIBITOR_ORG: "Gave someone two meetings with the same company",
  GROUP_BOUNDS: "Made a meeting larger or smaller than allowed",
  EXHIBITOR_TARGET: "Exhibitors below their target number of meetings",
  DELEGATE_TARGET: "Delegates below their target number of meetings",
  DELEGATE_SELF_EXCLUDED: "Delegates who refused every exhibitor, so had no one to meet",
  DELEGATE_DOUBLE_BOOKED: "Put someone in two meetings at the same time",
  ORG_COVERAGE: "Organizations with no meetings at all",
  PERSON_COVERAGE: "People with no meetings at all",
  EXHIBITOR_WITHOUT_SUITE: "Exhibitors with no suite, so no meetings",
  POLICY_RELAXATION_DISABLED: "Could not loosen the rules to fit more in (turned off)",
};
const SEVERITY_WORDS: Record<string, string> = { hard: "Stops the draft", soft: "Warning", info: "Note" };

type RunFinding = { code: string; severity: string; text: string; count: number };

function runFindings(diagnostics: unknown): { placed: number | null; findings: RunFinding[] } {
  const d = (diagnostics ?? {}) as { totalAssignments?: number; violations?: Array<Record<string, unknown>> };
  const byCode = new Map<string, RunFinding>();
  for (const v of d.violations ?? []) {
    const code = String(v.code ?? "UNKNOWN");
    const details = (v.details ?? {}) as Record<string, unknown>;
    const ids = [details.exhibitorSeatIds, details.delegateSeatIds].find(Array.isArray) as unknown[] | undefined;
    const entry = byCode.get(code) ?? {
      code,
      severity: String(v.severity ?? "info"),
      text: FINDING_WORDS[code] ?? String(v.message ?? code),
      count: 0,
    };
    entry.count += ids ? ids.length : 1;
    byCode.set(code, entry);
  }
  const order = { hard: 0, soft: 1, info: 2 } as Record<string, number>;
  return {
    placed: typeof d.totalAssignments === "number" ? d.totalAssignments : null,
    findings: [...byCode.values()].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3)),
  };
}

/**
 * A run's findings as sentences, worst first. A failed (infeasible) draft
 * keeps its meetings for the grid but can never be published.
 */
function DraftFindings({ diagnostics, broken }: { diagnostics: unknown; broken: boolean }) {
  const { placed, findings } = runFindings(diagnostics);
  return (
    <div className="space-y-3 text-sm text-gray-700">
      {placed !== null ? (
        <p>
          It placed {plural(placed, "meeting")}.
          {broken ? " They are saved, so you can see them in the grid, but this draft can't be published." : ""}
        </p>
      ) : null}
      <ul className="divide-y divide-gray-100">
        {findings.map((f) => (
          <li key={f.code} className="flex items-baseline justify-between gap-3 py-1.5">
            <span>
              <span
                className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  f.severity === "hard" ? "bg-red-50 text-red-700" : f.severity === "soft" ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-600"
                }`}
              >
                {SEVERITY_WORDS[f.severity] ?? f.severity}
              </span>
              {f.text}
            </span>
            {f.count > 1 ? <span className="shrink-0 text-xs text-gray-500">{f.count}</span> : null}
          </li>
        ))}
      </ul>
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">The run&apos;s full report</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-gray-800">
          {JSON.stringify(diagnostics ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const RUN_STATUS_WORDS: Record<string, string> = {
  running: "still running",
  completed: "ready",
  failed: "failed",
  infeasible: "could not fit everyone",
};

/**
 * Meetings (WAR_ROOM_OPERATE_PLAN §5): carry out the meeting schedule. The
 * Schedule page defines days, suites and cadence; everything that makes,
 * publishes, sends or changes the meetings themselves is here. Schedule Ops,
 * which did this before, is gone.
 */
export function MeetingsView({ conferenceId }: { conferenceId: string }) {
  const [overview, setOverview] = useState<MeetingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = async () => {
    const res = await loadMeetingsOverview(conferenceId);
    if (res.success) {
      setOverview(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  };
  useEffect(() => {
    let live = true;
    void loadMeetingsOverview(conferenceId).then((res) => {
      if (!live) return;
      if (res.success) setOverview(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [conferenceId]);

  if (!overview) {
    return <p className={`text-sm ${error ? "text-red-700" : "text-gray-500"}`}>{error ?? "Loading the meetings…"}</p>;
  }

  const base = `/admin/conference/${conferenceId}`;
  const { live, draft, email, meetings, canPublish } = overview;
  // Publishing and emailing stay super-admin acts on the server; an admin sees why.
  const superOnly = "Only a super admin can do this.";
  const draftReady = draft?.status === "completed";
  const draftBroken = draft?.status === "failed" || draft?.status === "infeasible";

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">The schedule</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Generate a draft"
            state={
              draft
                ? `Newest draft ${whenMountain(draft.startedAt)}: ${RUN_STATUS_WORDS[draft.status] ?? draft.status}${
                    draftReady ? `, ${plural(draft.meetings, "meeting")}` : ""
                  }.`
                : "No draft yet."
            }
            tone={draftBroken ? "blocked" : "neutral"}
            edit={{ href: `${base}/schedule`, label: "Days & suites" }}
            preview={
              draft && runFindings(draft.diagnostics).findings.length > 0
                ? {
                    title: draftBroken ? "Why the draft failed" : "What the draft could not do",
                    content: <DraftFindings diagnostics={draft.diagnostics} broken={draftBroken} />,
                  }
                : null
            }
            action={{
              label: "Generate",
              consequence: "Builds a new draft from today's seats and requests. The live schedule does not change.",
              onConfirm: async () => {
                const res = await createSchedulerDraftRun(conferenceId);
                await load();
                return res.success ? { success: true } : { success: false, error: res.error };
              },
            }}
          />
          <OperateRow
            title="Publish the schedule"
            state={
              !draftReady
                ? live
                  ? `Live: ${plural(live.meetings, "meeting")} for ${plural(live.people, "person")}. No new draft to publish.`
                  : "Nothing to publish: generate a draft first."
                : `${draft.changes.length === 0 ? "No changes" : plural(draft.changes.length, "change")} against ${
                    live ? `the live schedule (${plural(live.meetings, "meeting")})` : "nothing: nothing is live yet"
                  }.${canPublish ? "" : ` ${superOnly}`}`
            }
            tone={draftReady && draft.changes.length > 0 ? "attention" : "neutral"}
            preview={
              draftReady
                ? {
                    title: "What publishing changes",
                    content:
                      draft.changes.length === 0 ? (
                        <p className="text-sm text-gray-600">The draft is the same as the live schedule.</p>
                      ) : (
                        <table className="min-w-full divide-y divide-gray-200 text-xs">
                          <thead className="text-left text-gray-500">
                            <tr>
                              <th className="py-1.5 pr-3 font-medium">When</th>
                              <th className="py-1.5 pr-3 font-medium">Suite</th>
                              <th className="py-1.5 pr-3 font-medium">Now</th>
                              <th className="py-1.5 font-medium">After</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-gray-700">
                            {draft.changes.map((row) => (
                              <tr key={row.slotId}>
                                <td className="py-1.5 pr-3 whitespace-nowrap">
                                  Day {row.dayNumber}, {row.startTime.slice(0, 5)}
                                </td>
                                <td className="py-1.5 pr-3">{row.suiteNumber ?? "—"}</td>
                                <td className="py-1.5 pr-3">{row.live}</td>
                                <td className="py-1.5">{row.draft}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ),
                  }
                : null
            }
            action={
              draftReady && canPublish && (draft.changes.length > 0 || !live)
                ? {
                    label: "Publish",
                    consequence: `Makes this draft the live schedule: ${plural(draft.meetings, "meeting")}.${
                      live && live.handEdits > 0 ? ` The ${plural(live.handEdits, "hand edit")} in the live schedule are lost.` : ""
                    } Nobody is emailed until you send it.`,
                    onConfirm: async () => {
                      const res = await promoteSchedulerRun(conferenceId, draft.runId);
                      await load();
                      return res.success ? { success: true } : { success: false, error: res.error };
                    },
                  }
                : null
            }
          />
          <OperateRow
            title="Email everyone their schedule"
            state={
              !email
                ? "Nothing is live to send."
                : `${email.toSend.length === 0 ? "Everyone has been told" : `${plural(email.toSend.length, "person")} to tell`}${
                    email.alreadyTold ? `, ${email.alreadyTold} already told` : ""
                  }${email.noEmail ? `, ${email.noEmail} with no email address` : ""}.${canPublish ? "" : ` ${superOnly}`}${
                    sent ? ` ${sent}` : ""
                  }`
            }
            tone={email && email.noEmail > 0 ? "attention" : "neutral"}
            edit={email?.templateId ? { href: `/admin/comms/templates/${email.templateId}`, label: "Email" } : null}
            preview={
              email
                ? {
                    title: "Email everyone their schedule",
                    content: (
                      <div className="space-y-4 text-sm">
                        {email.sample ? (
                          <div className="rounded-lg border border-gray-200">
                            <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-600">
                              <p>To: {email.sample.to}</p>
                              <p className="font-medium text-gray-900">{email.sample.subject}</p>
                            </div>
                            {/* Sandboxed: the template's own HTML, nothing of the page's. */}
                            <iframe sandbox="" srcDoc={email.sample.bodyHtml} title="The email" className="h-80 w-full border-0" />
                          </div>
                        ) : (
                          <p className="text-gray-600">The schedule-ready email template is missing.</p>
                        )}
                        {email.toSend.length > 0 ? (
                          <div>
                            <p className="font-medium text-gray-900">Who it goes to</p>
                            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-xs text-gray-700">
                              {email.toSend.map((person) => (
                                <li key={person.email} className="flex justify-between gap-3">
                                  <span className="truncate">
                                    {person.name} · {person.orgName}
                                  </span>
                                  <span className="shrink-0 text-gray-500">{plural(person.meetingCount, "meeting")}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ),
                  }
                : null
            }
            action={
              email && canPublish && email.toSend.length > 0
                ? {
                    label: "Send",
                    consequence: `Emails ${plural(email.toSend.length, "person")} that their meetings are ready. Anyone already told about this schedule is skipped.`,
                    onConfirm: async () => {
                      const res = await emailActiveSchedule(conferenceId);
                      if (!res.success) return res;
                      setSent(`Sent to ${plural(res.data.sent, "person")}.`);
                      await load();
                      return { success: true };
                    },
                  }
                : null
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">On the day</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="The meeting grid"
            state={
              live
                ? `${plural(live.meetings, "meeting")} live${live.handEdits ? `, ${plural(live.handEdits, "hand edit")}` : ""}. Open a meeting to change or cancel it.`
                : draftReady
                  ? "Showing the draft: nothing is live yet."
                  : "No meetings yet."
            }
            extra={
              <button
                type="button"
                onClick={() => setGridOpen(true)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Open the grid
              </button>
            }
          />
          <OperateRow
            title="Meetings confirmed"
            state={
              !meetings || meetings.total === 0
                ? "No meetings in the live schedule."
                : meetings.started === 0
                  ? `None have started. The first is ${meetings.firstStartsLocal ?? "not timed"}.`
                  : `${meetings.confirmed} of ${meetings.started} started meetings confirmed by a check-in card.`
            }
            tone={meetings && meetings.unconfirmed.length > 0 ? "attention" : "neutral"}
            preview={
              meetings && meetings.unconfirmed.length > 0
                ? {
                    title: "Started, not confirmed",
                    content: (
                      <ul className="divide-y divide-gray-100 text-sm text-gray-700">
                        {meetings.unconfirmed.map((m) => (
                          <li key={m.scheduleId} className="flex justify-between gap-3 py-1.5">
                            <span>{m.exhibitorName}</span>
                            <span className="text-xs text-gray-500">
                              {m.startsAtLocal}
                              {m.suiteNumber ? ` · Suite ${m.suiteNumber}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ),
                  }
                : null
            }
          />
        </div>
      </section>

      {gridOpen ? (
        <Modal open onClose={() => setGridOpen(false)} title="The meeting grid" size="full">
          <div className="p-3">
            <MeetingMatrix conferenceId={conferenceId} data={overview.matrix} onChanged={() => void load()} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

