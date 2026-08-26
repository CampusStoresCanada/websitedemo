/**
 * /elections/accept/[token] — where a nominee lands from their invitation.
 *
 * Descends from app/board/vote/[token]: the token addresses the NOMINATION, and
 * the person is identified by their session. A nomination email is a document
 * that gets forwarded to assistants and colleagues; possession of the link must
 * never be enough to accept on someone's behalf.
 *
 * The page does three jobs at once, because the nominee only visits it once:
 * accept (with the bio and statement members will read), see what else is
 * outstanding, and — if the committee has asked — withdraw.
 */

import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import { getNominationByToken, nominationsOpen, resolveActor } from "@/lib/elections/service";
import { ElectionShell, Notice, OutstandingList, SignInPrompt } from "@/components/elections/ElectionShell";
import {
  acceptNominationAction,
  declineNominationAction,
  withdrawNominationAction,
  grantStorePermissionAction,
} from "@/lib/actions/elections";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function AcceptNominationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const auth = await getServerAuthState();

  if (!auth.user) return <SignInPrompt returnTo={`/elections/accept/${token}`} action="accept a nomination" />;

  const found = await getNominationByToken(token);
  if (!found) {
    return (
      <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Nomination not found">
        <p className="text-sm text-gray-600">
          That link doesn&apos;t match a nomination. It may have been withdrawn or superseded.
        </p>
      </ElectionShell>
    );
  }

  const { nomination, election } = found;
  const isNominee = !nomination.nomineeProfileId || nomination.nomineeProfileId === auth.user.id;

  const actor = await resolveActor(auth.user.id, auth.organizations);
  const canGrantStorePermission =
    !isNominee &&
    actor.adminOrganizationIds.includes(nomination.nomineeOrganizationId) &&
    !nomination.storePermissionGrantedAt;

  const windowOpen = nominationsOpen(election);
  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Board election`;

  if (!isNominee && !canGrantStorePermission) {
    // Someone else has the link. Say so plainly rather than 404ing, so a
    // forwarded email produces an explanation instead of a dead end.
    return (
      <ElectionShell eyebrow={eyebrow} title={nomination.nomineeName} subtitle={nomination.organizationName}>
        <Notice tone="info">
          This nomination belongs to {nomination.nomineeName}. Only they can accept, decline, or
          withdraw it, and only an administrator at {nomination.organizationName} can grant their
          institution&apos;s permission to serve.
        </Notice>
      </ElectionShell>
    );
  }

  if (nomination.withdrawnAt) {
    return (
      <ElectionShell eyebrow={eyebrow} title={nomination.nomineeName} subtitle={nomination.organizationName}>
        <Notice tone="info">This nomination was withdrawn on {formatDate(nomination.withdrawnAt)}.</Notice>
      </ElectionShell>
    );
  }

  if (nomination.candidateDeclinedAt) {
    return (
      <ElectionShell eyebrow={eyebrow} title={nomination.nomineeName} subtitle={nomination.organizationName}>
        <Notice tone="info">
          You declined this nomination on {formatDate(nomination.candidateDeclinedAt)}. If that was a
          mistake, contact the Executive Director before nominations close on{" "}
          {formatDate(election.schedule.nominationsCloseAt)}.
        </Notice>
      </ElectionShell>
    );
  }

  async function accept(formData: FormData) {
    "use server";
    const result = await acceptNominationAction(token, formData);
    if (result.ok) redirect(`/elections/accept/${token}?accepted=1`);
  }

  async function decline() {
    "use server";
    await declineNominationAction(token);
    redirect(`/elections/accept/${token}`);
  }

  async function withdraw(formData: FormData) {
    "use server";
    await withdrawNominationAction(token, formData);
    redirect(`/elections/accept/${token}`);
  }

  async function grantPermission() {
    "use server";
    await grantStorePermissionAction(nomination.id, token);
    redirect(`/elections/accept/${token}`);
  }

  const accepted = !!nomination.candidateAcceptedAt;

  return (
    <ElectionShell
      eyebrow={eyebrow}
      title={nomination.nomineeName}
      subtitle={`${nomination.organizationName} · nominated for the Board of Directors`}
    >
      {canGrantStorePermission && (
        <div className="mb-6 space-y-3">
          <Notice tone="warning">
            <strong>Your institution&apos;s permission is needed.</strong> The by-laws require{" "}
            {nomination.nomineeName}&apos;s member store to permit them to serve if elected. This is
            separate from their own acceptance — they cannot grant it themselves.
          </Notice>
          <form action={grantPermission}>
            <button
              type="submit"
              className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
            >
              Grant {nomination.organizationName}&apos;s permission
            </button>
          </form>
        </div>
      )}

      {isNominee && (
        <>
          <div className="mb-6 space-y-1 text-sm text-gray-600">
            <p>
              Nominations close <strong>{formatDate(election.schedule.nominationsCloseAt)}</strong>.
              {election.seatsAvailable} seat{election.seatsAvailable === 1 ? "" : "s"} are open, for a
              two-year term beginning at the annual general meeting on{" "}
              {formatDate(election.schedule.agmDate)}.
            </p>
          </div>

          {!windowOpen && (
            <div className="mb-6">
              <Notice tone="error">
                Nominations closed on {formatDate(election.schedule.nominationsCloseAt)} and cannot be
                reopened.
              </Notice>
            </div>
          )}

          {nomination.withdrawalRequestedAt && (
            <div className="mb-6">
              <Notice tone="info">
                The nominating committee has asked whether you would consider withdrawing. That is a
                question, not a decision — the choice is entirely yours, and doing nothing leaves your
                nomination standing.
              </Notice>
            </div>
          )}

          {accepted && (
            <div className="mb-6">
              <Notice tone="success">
                You accepted this nomination on {formatDate(nomination.candidateAcceptedAt!)}. You can
                keep editing your biography and statement until nominations close.
              </Notice>
            </div>
          )}

          <form action={accept} className="space-y-5">
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-gray-900">
                Biography
              </label>
              <p className="mt-1 text-xs text-gray-500">
                Your background in campus retail. Members read this alongside every other candidate.
              </p>
              <textarea
                id="bio"
                name="bio"
                rows={6}
                defaultValue={nomination.bio ?? ""}
                disabled={!windowOpen}
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-sm disabled:bg-gray-50"
              />
            </div>

            <div>
              <label htmlFor="platform" className="block text-sm font-medium text-gray-900">
                Candidate statement
              </label>
              <p className="mt-1 text-xs text-gray-500">
                What you would bring to the board, and what you would work on.
              </p>
              <textarea
                id="platform"
                name="platform"
                rows={6}
                defaultValue={nomination.platform ?? ""}
                disabled={!windowOpen}
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-sm disabled:bg-gray-50"
              />
            </div>

            {windowOpen && (
              <button
                type="submit"
                className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
              >
                {accepted ? "Save changes" : "Accept nomination"}
              </button>
            )}
          </form>

          <div className="mt-8">
            <OutstandingList items={nomination.completeness.missing} />
          </div>

          {windowOpen && (
            <div className="mt-8 border-t border-gray-200 pt-6">
              {accepted ? (
                <form action={withdraw} className="space-y-3">
                  <label htmlFor="reason" className="block text-sm font-medium text-gray-900">
                    Withdraw your nomination
                  </label>
                  <input
                    id="reason"
                    name="reason"
                    placeholder="Reason (optional)"
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Withdraw
                  </button>
                </form>
              ) : (
                <form action={decline}>
                  <button
                    type="submit"
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Decline this nomination
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </ElectionShell>
  );
}
