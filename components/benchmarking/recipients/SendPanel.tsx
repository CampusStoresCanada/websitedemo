"use client";

import { useState } from "react";
import { previewSend } from "@/lib/actions/benchmarking-recipients";
import { useSearchParams } from "next/navigation";

/**
 * The control that puts mail into 52 real inboxes.
 *
 * There is no undo, so the design is: you cannot reach the send button without
 * first seeing exactly who it would reach. The preview is not a courtesy step
 * that can be skipped — it is the only way to obtain the button, and it reads
 * the same plan the send consumes rather than a similar list built separately.
 *
 * Typing SEND is not theatre. The realistic failure here is not malice, it is
 * a stray click on the wrong tab during a busy week, and a control that mails
 * an entire membership should cost more than one click.
 */

type Kind = "invitation" | "reminder";

interface PlanShape {
  fiscalYear: number;
  surveyStatus: string;
  templateKey: string;
  killSwitchOn: boolean;
  willSend: { organizationName: string; contactName: string; to: string | null }[];
  blocked: { organizationName: string; blockedReason?: string }[];
}

interface ResultShape {
  sent?: number;
  failed?: number;
  skipped?: number;
  failures?: { organizationName: string; error?: string }[];
}

const BLOCKED_COPY: Record<string, string> = {
  already_invited: "already invited",
  already_submitted: "already filed",
  never_invited: "never received the invitation",
  no_address: "no address on file",
};

export default function SendPanel({
  surveyId,
  surveyStatus,
  fixedKind,
}: {
  surveyId: string;
  surveyStatus: string;
  /**
   * Lock the panel to one kind and hide the chooser.
   *
   * ⛔ A step that says "chase who has not filed" should not then ask which
   * message you meant. Same panel, same preview, same confirmation — only the
   * question it no longer needs to ask is removed.
   */
  fixedKind?: Kind;
}) {
  /*
    Arriving from a timeline step that says "Send a reminder" should put you on
    the reminder, not on the panel's default with the right option one more
    click away. ⛔ Preselects only; the preview is still a deliberate press and
    nothing sends without the confirmation, because arriving by link must never
    be mistaken for intent to send.
  */
  const requestedKind = useSearchParams().get("send");
  const [kind, setKind] = useState<Kind>(
    fixedKind ?? (requestedKind === "reminder" ? "reminder" : "invitation"),
  );
  const [plan, setPlan] = useState<PlanShape | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Any change to what would be sent invalidates an approval given for the
  // previous shape of it.
  function reset(next: () => void) {
    next();
    setPlan(null);
    setResult(null);
    setError(null);
  }

  async function onPreview() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await previewSend({ surveyId, kind });
    setBusy(false);
    if (!res.success || !res.plan) {
      setError(res.error ?? "Could not build the preview.");
      return;
    }
    setPlan(res.plan);
  }


  const count = plan?.willSend.length ?? 0;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Who can be sent to</h2>
      <p className="mt-1 text-sm text-gray-600">
        Preview first. Nothing goes out until you have seen the list and confirmed it.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {!fixedKind && (
          <label className="text-sm">
            <span className="mr-2 text-gray-700">What</span>
            <select
              value={kind}
              onChange={(e) => reset(() => setKind(e.target.value as Kind))}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="invitation">Invitation</option>
              <option value="reminder">Reminder</option>
            </select>
          </label>
        )}

        {/*
          ⛔ No "beta stores only" audience. A beta tester is invited by being
          appointed, which mails them the going-first copy and the survey link.
          This panel addressed the store's confirmed respondent instead, so a
          cohort store got two invitations aimed at two people and only the
          appointment one actually opened anything.
        */}

        <button
          type="button"
          onClick={onPreview}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy && !plan ? "Checking…" : "Preview"}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      {plan && (
        <div className="mt-5 border-t border-gray-200 pt-4">
          {plan.killSwitchOn && (
            <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <strong>BENCHMARKING_SUPPRESS_EMAIL is set.</strong> Sending now would mail
              nobody and mark nothing as invited. Unset it before a real send, or this run
              will look successful and reach no one.
            </p>
          )}

          <p className="text-sm text-gray-900">
            <strong>
              {count} {count === 1 ? "store" : "stores"}
            </strong>{" "}
            would receive the <code className="text-xs">{plan.templateKey}</code> email.
          </p>

          {count > 0 && (
            <ul className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-gray-200 text-sm">
              {plan.willSend.map((l, i) => (
                <li
                  key={`${l.organizationName}-${i}`}
                  className="flex justify-between gap-3 border-b border-gray-100 px-3 py-1.5 last:border-b-0"
                >
                  <span className="text-gray-900">{l.organizationName}</span>
                  <span className="text-gray-500">
                    {l.contactName} · {l.to}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {plan.blocked.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-gray-600">
                {plan.blocked.length} not included
              </summary>
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 text-sm">
                {plan.blocked.map((l, i) => (
                  <li
                    key={`${l.organizationName}-${i}`}
                    className="flex justify-between gap-3 border-b border-gray-100 px-3 py-1.5 last:border-b-0"
                  >
                    <span className="text-gray-900">{l.organizationName}</span>
                    <span className="text-gray-500">
                      {BLOCKED_COPY[l.blockedReason ?? ""] ?? l.blockedReason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/*
            ⛔ No send button here. Sending is a quick act and it lives in the
            timeline step, armed and confirmed by the count — the same control
            elections uses. This panel is the work you do BEFORE that: who is in
            scope, who cannot be reached and why. Two places to mail 53 stores
            from would be the duplication; one place to read the list and one
            place to act is the split.
          */}
          {count > 0 ? (
            <p className="mt-4 text-sm text-gray-700">
              <strong>{count}</strong> ready to send. The act is on the step
              above, which names the number before it goes.
            </p>
          ) : (
            <p className="mt-4 text-sm text-gray-600">
              Nothing to send. Everyone in scope is listed above with the reason.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="mt-5 border-t border-gray-200 pt-4">
          <p className="text-sm text-gray-900">
            Sent <strong>{result.sent ?? 0}</strong>
            {(result.failed ?? 0) > 0 && <> · failed {result.failed}</>}
            {(result.skipped ?? 0) > 0 && <> · not included {result.skipped}</>}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            &ldquo;Sent&rdquo; means Resend accepted the message. Delivery events do not
            reach us, so this is what we attempted, not what landed.
          </p>
          {result.failures && result.failures.length > 0 && (
            <ul className="mt-3 rounded-lg border border-red-200 bg-red-50 text-sm">
              {result.failures.map((f, i) => (
                <li
                  key={`${f.organizationName}-${i}`}
                  className="flex justify-between gap-3 border-b border-red-100 px-3 py-1.5 last:border-b-0"
                >
                  <span className="text-red-900">{f.organizationName}</span>
                  <span className="text-red-700">{f.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
