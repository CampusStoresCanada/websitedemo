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
  BOARD_SERVICE_BENEFITS,
  BOARD_SERVICE_CONSIDERATIONS,
  BOARD_SERVICE_NEXT_STEP,
} from "@/lib/elections/board-service";
import {
  acceptNominationAction,
  inviteCosignerAction,
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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string; slug?: string; asked?: string; error?: string }>;
}) {
  const { token } = await params;
  const { preview, slug: previewSlug, asked, error: askError } = await searchParams;
  const auth = await getServerAuthState();

  if (!auth.user) return <SignInPrompt returnTo={`/elections/accept/${token}`} action="accept a nomination" />;

  // The token pages are the only member-facing screens with no URL an admin
  // could visit, because the token does not exist until a nomination does. A
  // stand-in lets the committee see them before the cycle opens.
  const { isAdminPreview, PREVIEW_BANNER, sampleNomination } = await import("@/lib/elections/preview");
  const adminPreview = await isAdminPreview({ preview });
  const previewing = token === "preview" && adminPreview;
  // An admin opening a REAL nomination's page, to see where that nominee has
  // got to. The committee screen already lists what is outstanding; this is the
  // same facts on the page the nominee is looking at, which is what somebody
  // chasing them actually wants to see.
  //
  // ⛔ READ-ONLY, and not by relying on the actions to refuse. Every control is
  // withheld below, because the page is being viewed by someone who is neither
  // the nominee nor an administrator of their institution and must not be one
  // misread condition away from acting as either.
  const viewingAsAdmin = token !== "preview" && adminPreview;

  const found = previewing
    ? await (async () => {
        const { getElection } = await import("@/lib/elections/service");
        const e = await getElection(previewSlug ?? "");
        return e
          ? {
              nomination: sampleNomination({
                electionId: e.id,
                cosignersRequired: e.config.nominations.cosignersRequired,
                nominationsCloseAt: e.schedule.nominationsCloseAt,
              }),
              election: e,
            }
          : null;
      })()
    : await getNominationByToken(token);

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
  // The nominee is NOT excluded. Where they administer their own institution
  // they are the store's authority, and 40 of the 50 eligible institutions have
  // only one administrator — so excluding them left those nominations with
  // nobody able to grant permission at all. See grantStorePermission.
  const canGrantStorePermission =
    actor.adminOrganizationIds.includes(nomination.nomineeOrganizationId) &&
    !nomination.storePermissionGrantedAt;

  const windowOpen = nominationsOpen(election);
  // Distinguishes "not yet" from "too late" — see the notice below.
  const beforeWindow =
    new Date().toISOString().slice(0, 10) < election.schedule.nominationsOpenAt;
  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Board election`;

  if (!isNominee && !canGrantStorePermission && !viewingAsAdmin) {
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

  async function inviteCosigner(formData: FormData) {
    "use server";
    const r = await inviteCosignerAction(token, formData);
    redirect(
      `/elections/accept/${token}${r.ok ? "?asked=1" : `?error=${encodeURIComponent(r.error ?? "")}`}`
    );
  }

  async function grantPermission() {
    "use server";
    await grantStorePermissionAction(nomination.id, token);
    redirect(`/elections/accept/${token}`);
  }

  const accepted = !!nomination.candidateAcceptedAt;
  // One switch, used on every control below, so adding a new one and
  // forgetting it is the visible kind of mistake rather than the silent kind.
  const canAct = windowOpen && !viewingAsAdmin;
  // What the nominee sees. An admin looking in gets the same thing — that is
  // the point of the link, and the banner promises exactly it — with every
  // control already withheld by canAct.
  const showNomineeView = isNominee || viewingAsAdmin;

  // Who is left to ask. Excludes the ones already invited and, unless the
  // config allows self-co-signature, the nominee's own institution.
  const { listCosignerOrganizations } = await import("@/lib/elections/service");
  const alreadyAsked = nomination.cosignatures.signingOrganizationIds;
  const askable =
    showNomineeView && nomination.cosignatures.valid < nomination.cosignatures.required
      ? await listCosignerOrganizations(election.id, [
          ...alreadyAsked,
          ...(election.config.nominations.selfCosignatureAllowed
            ? []
            : [nomination.nomineeOrganizationId]),
        ])
      : [];

  return (
    <ElectionShell
      eyebrow={eyebrow}
      title={nomination.nomineeName}
      subtitle={`${nomination.organizationName} · nominated for the Board of Directors`}
    >
      {previewing && <Notice tone="info">{PREVIEW_BANNER}</Notice>}
      {asked && (
        <Notice tone="success">
          Asked. Every administrator there has the request, and your nomination updates the moment
          one of them signs.
        </Notice>
      )}
      {askError && <Notice tone="warning">{askError}</Notice>}
      {viewingAsAdmin && (
        <Notice tone="info">
          <strong>You are looking at {nomination.nomineeName}&apos;s own page.</strong> This is what
          they see, with their real progress. Nothing here can be changed from your account, and
          they have not been told you opened it.
        </Notice>
      )}
      {canGrantStorePermission && (
        <div className="mb-6 space-y-3">
          <Notice tone="warning">
            {isNominee ? (
              <>
                <strong>Your institution&apos;s permission is still needed.</strong> By-Law Part V
                requires {nomination.organizationName} to permit you to serve if elected, which is a
                separate decision from your own acceptance. You administer{" "}
                {nomination.organizationName}, so you can give it here. It is recorded as your own
                decision and the nominating committee sees who granted it.
              </>
            ) : (
              <>
                <strong>Your institution&apos;s permission is needed.</strong> By-Law Part V requires{" "}
                {nomination.nomineeName}&apos;s member store to permit them to serve if elected. It
                is a separate decision from their own acceptance to stand.
              </>
            )}
          </Notice>
          <form action={grantPermission}>
            <button
              type="submit"
              className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
            >
              {isNominee
                ? `Grant ${nomination.organizationName}'s permission to serve`
                : `Grant ${nomination.organizationName}'s permission`}
            </button>
          </form>
        </div>
      )}

      {/* The nominee is the one person being asked to decide, and until now this
          page told them only what the process required of them — dates, a bio,
          a statement — and never what they would be taking on or why anyone
          does it. CSC's own case belongs here more than anywhere else. */}
      {showNomineeView && (
        <details className="mb-6 rounded-lg border border-gray-200 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">
            What you are being asked to take on
          </summary>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {BOARD_SERVICE_BENEFITS.map((b) => (
              <div key={b.label} className="text-sm">
                <dt className="font-medium text-gray-900">{b.label}</dt>
                <dd className="text-gray-600">{b.detail}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-sm font-medium text-gray-900">What it asks of you</p>
            <dl className="mt-1.5 space-y-1.5">
              {BOARD_SERVICE_CONSIDERATIONS.map((c) => (
                <div key={c.label} className="text-sm">
                  <dt className="inline font-medium text-gray-900">{c.label} — </dt>
                  <dd className="inline text-gray-600">{c.detail}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-gray-600">{BOARD_SERVICE_NEXT_STEP}</p>
          </div>
        </details>
      )}

      {showNomineeView && (
        <>
          <div className="mb-6 space-y-1 text-sm text-gray-600">
            <p>
              Nominations close <strong>{formatDate(election.schedule.nominationsCloseAt)}</strong>.
              {election.seatsAvailable} seat{election.seatsAvailable === 1 ? "" : "s"} are open, for a
              two-year term beginning at the annual general meeting on{" "}
              {formatDate(election.schedule.agmDate)}.
            </p>
          </div>

          {/* "Not open" has two causes and they read very differently to a
              nominee. Before the window, this said nominations "closed on"
              a date still in the future — which tells someone who has just been
              asked to stand that they are already too late. */}
          {!windowOpen && (
            <div className="mb-6">
              <Notice tone={beforeWindow ? "info" : "error"}>
                {beforeWindow ? (
                  <>
                    Nominations open {formatDate(election.schedule.nominationsOpenAt)}. You can
                    accept and write your statement from that date until{" "}
                    {formatDate(election.schedule.nominationsCloseAt)}.
                  </>
                ) : (
                  <>
                    Nominations closed on {formatDate(election.schedule.nominationsCloseAt)} and
                    cannot be reopened.
                  </>
                )}
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
                disabled={!canAct}
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
                disabled={!canAct}
                className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-sm disabled:bg-gray-50"
              />
            </div>

            {canAct && (
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

          {/* The invitation list used to be frozen at submission. Invite two,
              have one never act, and the nomination was stuck with no way to
              ask anybody else — watching it fail with nothing to press. */}
          {canAct && askable.length > 0 && (
            <div className="mt-6 rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-sm font-medium text-gray-900">Ask another institution</p>
              <p className="mt-1 text-xs text-gray-600">
                You need {nomination.cosignatures.required} signatures and have{" "}
                {nomination.cosignatures.valid}. Asking more institutions than you need is
                sensible: whoever signs first counts, and the others simply do nothing.
              </p>
              <form action={inviteCosigner} className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  name="organizationId"
                  aria-label="Institution to ask"
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {askable.map((o) => (
                    <option key={o.organizationId} value={o.organizationId}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Ask them to co-sign
                </button>
              </form>
              <p className="mt-2 text-xs text-gray-500">
                Emails every administrator there. They still have to agree.
              </p>
            </div>
          )}

          {canAct && (
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
