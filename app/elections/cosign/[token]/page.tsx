/**
 * /elections/cosign/[token] — where an invited institution co-signs a nomination.
 *
 * By-Law Part V S2(c) requires two Primary Store Contacts to sign an additional
 * nomination. In practice that term is retired and member stores run several
 * administrators, so the signature belongs to the INSTITUTION: any active admin
 * of the invited store may sign for it, and the two signatures must come from
 * two different stores. Both rules are enforced in signCosignature().
 */

import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import { getCosignatureByToken, nominationsOpen, resolveActor } from "@/lib/elections/service";
import { ElectionShell, Notice, SignInPrompt } from "@/components/elections/ElectionShell";
import { signCosignatureAction } from "@/lib/actions/elections";

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

export default async function CosignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const auth = await getServerAuthState();

  if (!auth.user) return <SignInPrompt returnTo={`/elections/cosign/${token}`} action="co-sign a nomination" />;

  const found = await getCosignatureByToken(token);
  if (!found) {
    return (
      <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Signing request not found">
        <p className="text-sm text-gray-600">
          That link doesn&apos;t match a request for a signature. It may have been withdrawn.
        </p>
      </ElectionShell>
    );
  }

  const { nomination, election, organizationName, organizationId, signedAt, revokedAt } = found;
  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Board election`;
  const actor = await resolveActor(auth.user.id, auth.organizations);
  const isAdminHere = actor.adminOrganizationIds.includes(organizationId);
  const windowOpen = nominationsOpen(election);

  async function sign() {
    "use server";
    const result = await signCosignatureAction(token);
    redirect(
      result.ok
        ? `/elections/cosign/${token}`
        : `/elections/cosign/${token}?error=${encodeURIComponent(result.error ?? "Could not sign.")}`
    );
  }

  return (
    <ElectionShell
      eyebrow={eyebrow}
      title={`Co-sign the nomination of ${nomination.nomineeName}`}
      subtitle={`${nomination.organizationName} · for the Board of Directors`}
    >
      {revokedAt ? (
        <Notice tone="info">This signing request was withdrawn.</Notice>
      ) : signedAt ? (
        <Notice tone="success">
          <strong>{organizationName} has signed.</strong> Recorded {formatDate(signedAt)}. This
          nomination now has {nomination.cosignatures.valid} of {nomination.cosignatures.required}{" "}
          signatures.
        </Notice>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            {nomination.nomineeName} of {nomination.organizationName} has been nominated for the
            Board of Directors. The by-laws require nominations from the membership to be signed by
            two member institutions, and {organizationName} has been asked to be one of them.
          </p>
          <p className="mt-3 text-sm text-gray-600">
            Signing says your institution supports putting this name in front of the members. It is
            not a vote, and it does not commit {organizationName} to voting for them.
          </p>

          {nomination.bio && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Biography</p>
              <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{nomination.bio}</p>
            </div>
          )}

          {error && (
            <div className="mt-6">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          {!windowOpen ? (
            <div className="mt-6">
              <Notice tone="error">
                Nominations closed on {formatDate(election.schedule.nominationsCloseAt)}, so this
                nomination can no longer be signed.
              </Notice>
            </div>
          ) : !isAdminHere ? (
            <div className="mt-6">
              <Notice tone="warning">
                This request was sent to <strong>{organizationName}</strong>, and you are not
                recorded as one of its administrators. Any administrator at {organizationName} can
                sign it — the signature belongs to the institution, not to one person.
              </Notice>
            </div>
          ) : (
            <form action={sign} className="mt-6">
              <button
                type="submit"
                className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
              >
                Sign on behalf of {organizationName}
              </button>
            </form>
          )}
        </>
      )}

      <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
        Nominations close {formatDate(election.schedule.nominationsCloseAt)}. The annual general
        meeting is {formatDate(election.schedule.agmDate)}.
      </p>
    </ElectionShell>
  );
}
