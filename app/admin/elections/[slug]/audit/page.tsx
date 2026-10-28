/**
 * /admin/elections/[slug]/audit — the scrutineer's view.
 *
 * By-Law Part V S3(b): the President appoints a scrutineer to receive and count
 * the ballots. This is what they get — the roll of institutions that returned a
 * ballot, the totals per candidate, and the reconciliation between the two.
 *
 * There is deliberately no path from one to the other, and after sealing there
 * is none to offer: the rows that joined an institution to a selection have been
 * deleted. That is the difference between promising secrecy and arranging for it.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { getAuditView, getResultsAnnouncement, listScrutineerCandidates } from "@/lib/elections/service";
import ConfirmSubmitButton from "@/components/admin/elections/ConfirmSubmitButton";
import BoardTransitionPanel from "@/components/admin/elections/BoardTransitionPanel";
import {
  sealElectionAction,
  recordTieResolutionAction,
  certifyElectionAction,
  announceResultsAction,
} from "@/lib/actions/elections";

export const metadata = { title: "Election audit | Admin | Campus Stores Canada" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default async function ElectionAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; announced?: string; moved?: string; groups?: string }>;
}) {
  const { slug } = await params;
  const { error, announced, moved, groups } = await searchParams;
  const [audit, scrutineers] = await Promise.all([
    getAuditView(slug),
    listScrutineerCandidates(),
  ]);
  if (!audit) notFound();
  const results = await getResultsAnnouncement(slug);
  const { getBoardTransition } = await import("@/lib/elections/service");
  const transition = await getBoardTransition(slug);

  const { election, roll, sealedCount, reconciled, count, certification } = audit;
  async function applyTransition(formData: FormData) {
    "use server";
    const { applyBoardTransitionAction } = await import("@/lib/actions/elections");
    const r = await applyBoardTransitionAction(slug, formData);
    if (!r.ok) redirect(`/admin/elections/${slug}/audit?error=${encodeURIComponent(r.error ?? "")}`);
    // The group lines travel back with the redirect so the person who pressed
    // reads them, rather than having to go and look at the rules screen.
    const lines = (r.groups ?? []).join(" | ");
    const q = new URLSearchParams({ moved: r.groupsFailed ? "failed" : "1" });
    if (lines) q.set("groups", lines);
    redirect(`/admin/elections/${slug}/audit?${q.toString()}`);
  }

  const sealed = election.status === "sealed" || election.status === "certified";
  // An acclaimed slate never passes through balloting, so it is never sealed —
  // and the Certify section below is gated on sealing. Without this the one act
  // that unblocks telling the candidates and announcing the result had no
  // button anywhere on the page.
  const acclaimedAwaitingCertification =
    election.outcome === "acclaimed" && election.status === "nominations_closed";

  async function seal(formData: FormData) {
    "use server";
    const r = await sealElectionAction(slug, formData);
    redirect(
      `/admin/elections/${slug}/audit${r.error ? `?error=${encodeURIComponent(r.error)}` : ""}`
    );
  }
  async function resolveTie(formData: FormData) {
    "use server";
    const r = await recordTieResolutionAction(slug, formData);
    redirect(
      `/admin/elections/${slug}/audit${r.ok ? "" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }
  async function announce(formData: FormData) {
    "use server";
    const r = await announceResultsAction(slug, formData);
    redirect(
      `/admin/elections/${slug}/audit${r.ok ? "?announced=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function certify(formData: FormData) {
    "use server";
    const r = await certifyElectionAction(slug, formData);
    redirect(
      `/admin/elections/${slug}/audit${r.ok ? "" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`${election.cycleYear} election — audit`}
        description={`${election.seatsAvailable} seats · status ${election.status}`}
        actions={
          <Link href={`/admin/elections/${slug}`} className="text-sm text-gray-600 underline">
            Back to the election
          </Link>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}
      {moved && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            moved === "failed"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-green-200 bg-green-50 text-green-900"
          }`}
        >
          Board access moved. Check the names on the panel below — anybody skipped is listed there
          with the reason, and Circle removals are a separate obligation on the board&apos;s list.
          {groups && (
            <ul className="mt-2 space-y-1">
              {groups.split(" | ").map((line) => (
                <li key={line}>
                  {moved === "failed" ? "⚠️ " : "✓ "}
                  {line}
                </li>
              ))}
            </ul>
          )}
          {moved === "failed" && (
            <p className="mt-2 font-medium">
              The mailing list did not fully take. Nothing else is blocked — fix the address or add
              the person in Workspace, then press this again.
            </p>
          )}
        </div>
      )}

      {announced && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          The result has gone to the membership.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Institutions that voted
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{roll.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sealed ballots</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{sealedCount}</p>
        </div>
        <div
          className={`rounded-lg border px-4 py-3 ${
            sealed && !reconciled ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Reconciles</p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              !sealed ? "text-gray-400" : reconciled ? "text-green-700" : "text-red-700"
            }`}
          >
            {!sealed ? "—" : reconciled ? "Yes" : "NO"}
          </p>
        </div>
      </div>

      {!sealed && election.status === "balloting" && (
        <section className="rounded-lg border border-red-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Seal the ballots</h2>
          <div className="mt-2 space-y-2 text-sm text-gray-700">
            <p>
              Sealing permanently removes the link between every ballot and the institution that
              cast it. Afterwards the record shows <strong>that</strong> each institution voted and
              never <strong>how</strong> — and a disputed ballot cannot be traced back to anyone,
              including by you.
            </p>
            <p className="font-medium text-red-800">
              This cannot be undone. There is no recovery and no second copy.
            </p>
          </div>
          <form action={seal} className="mt-4 flex items-center gap-3">
            <input
              name="confirm"
              placeholder="Type SEAL"
              className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20]"
            >
              Seal {roll.length} ballot{roll.length === 1 ? "" : "s"}
            </button>
          </form>
        </section>
      )}

      {count && (
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">The count</h2>
            <p className="mt-1 text-xs text-gray-500">{count.summary}</p>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {count.results.map((r) => (
                <tr key={r.nominationId} className={r.elected ? "bg-green-50/50" : undefined}>
                  <td className="px-5 py-2 tabular-nums text-gray-500">{r.rank}</td>
                  <td className="px-2 py-2">
                    <span className="font-medium text-gray-900">{r.displayName}</span>
                    <span className="block text-xs text-gray-500">{r.organizationName}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700">{r.votes}</td>
                  <td className="px-5 py-2 text-right">
                    {r.elected ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Elected
                      </span>
                    ) : r.tiedAtCutoff ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Tied
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {count?.tieAtCutoff && !count.tieSettled && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <h2 className="text-sm font-semibold text-amber-900">A tie has to be resolved by a person</h2>
          <p className="mt-1 text-sm text-amber-900">
            {count.tiedCandidates.map((c) => c.displayName).join(" and ")} are tied for the last
            seat. By-Law No. 1 prescribes no tie-break, so whatever you record here becomes the
            precedent — write it as something a future board would be content to be bound by.
          </p>
          <form action={resolveTie} className="mt-4 space-y-3">
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-amber-900">
                Who takes the remaining seat{count.seats - count.seatsResolved === 1 ? "" : "s"}
              </legend>
              {count.tiedCandidates.map((c) => (
                <label key={c.nominationId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="elected" value={c.nominationId} className="h-4 w-4" />
                  {c.displayName}
                </label>
              ))}
            </fieldset>
            <select name="method" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="refer_to_agm">Referred to the members at the AGM (Part V S3(e))</option>
              <option value="board_appoints">Seat left vacant; board appointed (Part IV S3)</option>
              <option value="other">Other</option>
            </select>
            <textarea
              name="note"
              rows={3}
              placeholder="How it was resolved, and on what authority."
              className="w-full rounded-lg border border-gray-300 p-3 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#2B2E33] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a1d21]"
            >
              Record the resolution
            </button>
          </form>
        </section>
      )}

      {acclaimedAwaitingCertification && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Certify the acclamation</h2>
          <p className="mt-1 text-sm text-gray-600">
            As many nominees stood as there were seats, so no ballot was circulated and there is
            nothing to count or seal. Certifying records that the slate is final. By-Law Part V
            S3(d) has the Chair announce the acclaimed candidates at the meeting, and this is the
            record behind that.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            No scrutineer is recorded, because no ballots were cast for one to count. Nothing is
            sent by this — it unlocks telling the candidates and announcing the result, both of
            which stay separate acts.
          </p>
          <form action={certify} className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Certify the acclaimed slate
            </button>
          </form>
        </section>
      )}

      {sealed && !certification?.certifiedAt && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Certify</h2>
          <form action={certify} className="mt-3 flex flex-wrap items-end gap-3">
            {/* A named list, not an id. By-Law Part V S3(b) makes the scrutineer
                a real appointment, and this is the record of it — but the field
                was a raw contact id typed into a text box, so in practice it was
                always left blank and the appointment went unrecorded. */}
            <label className="text-xs text-gray-600">
              <span className="block font-medium text-gray-900">
                Scrutineer <span className="font-normal text-gray-500">(optional)</span>
              </span>
              <select
                name="scrutineerContactId"
                defaultValue=""
                className="mt-1 w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Not recorded</option>
                {scrutineers.map((s) => (
                  <option key={s.contactId} value={s.contactId}>
                    {s.name} — {s.organizationName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-[#B92026] px-4 py-2 text-sm font-medium text-white hover:bg-[#9c1b20]"
            >
              Certify the result
            </button>
          </form>
        </section>
      )}

      {certification?.certifiedAt && (
        <section className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-900">
          <p>
            <strong>Certified</strong> {formatWhen(certification.certifiedAt)}
            {certification.certifiedByName ? ` by ${certification.certifiedByName}` : ""}
            {certification.scrutineerName ? ` · scrutineer ${certification.scrutineerName}` : ""}.
          </p>
          {certification.tieResolutionNote && (
            <p className="mt-2">
              <strong>Tie resolution</strong> ({certification.tieResolutionMethod}):{" "}
              {certification.tieResolutionNote}
            </p>
          )}
        </section>
      )}

      {transition && (
        <BoardTransitionPanel
          plan={transition.plan}
          agmDate={transition.agmDate}
          conferenceEndsOn={transition.conferenceEndsOn}
          certified={transition.certified}
          apply={applyTransition}
        />
      )}

      {certification?.certifiedAt && results && (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Announce the result</h2>
          <p className="mt-1 text-xs text-gray-500">
            By-Law Part V S3(e) — the members elect at the meeting, so this is written in the
            past tense of a meeting that has happened and cannot go out before it.
          </p>

          <div
            className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 [&_p]:mt-2 first:[&_p]:mt-0"
            dangerouslySetInnerHTML={{ __html: results.html }}
          />

          {results.blockedReason ? (
            <p className="mt-3 text-sm text-red-700">{results.blockedReason}</p>
          ) : (
            <form action={announce} className="mt-3">
              {!results.meetingHasHappened && (
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" name="confirmMeetingHeld" value="1" className="mt-0.5" />
                  <span>
                    The meeting on {results.election.schedule.agmDate} has taken place and the
                    members elected this board. Without this, nothing sends — until the meeting
                    happens nobody has been elected.
                  </span>
                </label>
              )}
              {!results.candidatesTold && (
                <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" name="confirmCandidatesTold" value="1" className="mt-0.5" />
                  <span>
                    The candidates already know. Use &ldquo;Tell the candidates&rdquo; on the cycle
                    screen, or tick this if you have told them yourself — anyone who was not elected
                    should not learn it from a message addressed to every member store.
                  </span>
                </label>
              )}

              {/* ⚠️ This was the one membership-wide send the confirmation never
                  reached — it lives on the audit screen rather than the
                  timeline, so the sweep that covered the others walked straight
                  past it. It emails every eligible institution in one press,
                  which is exactly the shape of the send that went out by
                  accident. */}
              <ConfirmSubmitButton
                label={`Send to ${results.recipients} member institution${results.recipients === 1 ? "" : "s"}`}
                recipients={results.recipients}
                audience="member institutions"
              />
              <span className="ml-3 text-xs text-gray-500">Sends once.</span>
            </form>
          )}
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            The roll — who returned a ballot ({roll.length})
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            That an institution voted, and when it first did. Never how. There is no view that
            joins this list to the count, and after sealing no data that could produce one.
          </p>
        </div>
        <ul className="divide-y divide-gray-100 text-sm">
          {roll.map((r) => (
            <li key={r.organizationName} className="flex justify-between px-5 py-2">
              <span className="text-gray-900">{r.organizationName}</span>
              <span className="text-gray-500">
                {formatWhen(r.firstCastAt)}
                {r.abstained && " · abstained"}
              </span>
            </li>
          ))}
          {roll.length === 0 && <li className="px-5 py-6 text-gray-500">No ballots returned yet.</li>}
        </ul>
      </section>
    </div>
  );
}
