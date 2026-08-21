/**
 * /elections/[slug]/nominate — the membership's nomination form.
 *
 * Two steps, both server-rendered and carried in the URL rather than in client
 * state: find the person, then decide who stands behind the nomination. No
 * client JS, because the people using this do so once a year from an email link
 * and half of them will be on an institutional browser we have never seen.
 *
 * The form's job beyond collecting a name is to be honest about what happens
 * next. A nomination is not finished when it is submitted — the nominee still
 * has to accept, their institution still has to permit them to serve, and a
 * second institution still has to co-sign. Someone who submits believing they
 * are done is how a nomination quietly expires at the close.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import {
  getElection,
  nominationsOpen,
  resolveActor,
  isOrganizationEligible,
  listNominatableContacts,
  getNominatableContact,
  listCosignerOrganizations,
  planNomination,
} from "@/lib/elections/service";
import { ElectionShell, Notice, SignInPrompt } from "@/components/elections/ElectionShell";
import { submitNominationAction } from "@/lib/actions/elections";

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

export default async function NominatePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; nominee?: string; submitted?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { q, nominee: nomineeId, submitted, error } = await searchParams;

  const auth = await getServerAuthState();
  if (!auth.user)
    return <SignInPrompt returnTo={`/elections/${slug}/nominate`} action="put forward a nomination" />;

  const election = await getElection(slug);
  if (!election) {
    return (
      <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Election not found">
        <p className="text-sm text-gray-600">That election doesn&apos;t exist.</p>
      </ElectionShell>
    );
  }

  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Board election`;

  if (submitted) {
    return (
      <ElectionShell eyebrow={eyebrow} title="Nomination submitted">
        <Notice tone="success">
          <strong>Recorded.</strong> Your institution&apos;s signature is on it.
        </Notice>
        <div className="mt-6 space-y-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">It is not finished yet. Three things still have to happen:</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong>The nominee accepts</strong>, and writes their biography and candidate
              statement. We have emailed them a link.
            </li>
            <li>
              <strong>Their institution grants permission</strong> for them to serve if elected.
              The by-laws require this separately from the nominee&apos;s own acceptance.
            </li>
            <li>
              <strong>The institutions you asked co-sign.</strong> They have each been sent a link.
            </li>
          </ol>
          <p>
            All three must be done by <strong>{formatDate(election.schedule.nominationsCloseAt)}</strong>.
            A nomination that is short of any of them on that date does not go on the ballot, so it is
            worth a nudge if you don&apos;t see movement.
          </p>
        </div>
        <div className="mt-6 flex gap-3">
          <Link
            href={`/elections/${slug}/nominate`}
            className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
          >
            Nominate someone else
          </Link>
        </div>
      </ElectionShell>
    );
  }

  // Which of the viewer's institutions is doing the nominating. Almost always
  // one; a person who administers two member stores has to say which.
  const actor = await resolveActor(auth.user.id, auth.organizations);
  const eligibleNominatorOrgs: { organizationId: string; name: string; contactId: string }[] = [];
  for (const orgId of actor.adminOrganizationIds) {
    const verdict = await isOrganizationEligible(election.id, orgId);
    const contactId = actor.contactIdFor(orgId);
    if (verdict?.isEligible && contactId)
      eligibleNominatorOrgs.push({
        organizationId: orgId,
        name: verdict.facts ? verdict.reason.split(" is ")[0] : "Your institution",
        contactId,
      });
  }

  if (!nominationsOpen(election) || election.status !== "nominating") {
    return (
      <ElectionShell eyebrow={eyebrow} title="Nominations are not open">
        <Notice tone="info">
          Nominations for the {election.cycleYear} board run{" "}
          {formatDate(election.schedule.nominationsOpenAt)} to{" "}
          {formatDate(election.schedule.nominationsCloseAt)}.
        </Notice>
      </ElectionShell>
    );
  }

  if (eligibleNominatorOrgs.length === 0) {
    // Distinguish "your store hasn't renewed" from "you're not an admin" —
    // the first is fixable today by the person reading this.
    const anyOrgVerdicts = await Promise.all(
      actor.adminOrganizationIds.map((id) => isOrganizationEligible(election.id, id))
    );
    const renewalBlocked = anyOrgVerdicts.find((v) => v?.reasonCode === "renewal_outstanding");
    // CSC staff land here too, and for them nothing is broken — the association's
    // own employees are not members and do not nominate. Saying "your account
    // isn't recorded" to the Executive Director reads as a bug and would send
    // him looking for one.
    const isAssociationStaff =
      auth.globalRole === "super_admin" && actor.adminOrganizationIds.length > 0;

    return (
      <ElectionShell
        eyebrow={eyebrow}
        title={isAssociationStaff ? "Nominations come from the membership" : "You cannot nominate yet"}
      >
        {renewalBlocked ? (
          <Notice tone="warning">
            {renewalBlocked.reason} Once the renewal is recorded you can come straight back to this
            page — nothing else is needed.
          </Notice>
        ) : isAssociationStaff ? (
          <Notice tone="info">
            Nominations are put forward by member institutions, so association staff accounts
            can&apos;t submit one. Nothing is wrong with your account. To follow how nominations are
            coming in, use the{" "}
            <Link href={`/admin/elections/${slug}`} className="underline">
              election review page
            </Link>
            .
          </Notice>
        ) : (
          <Notice tone="info">
            Nominations come from member institutions, put forward by one of their administrators.
            Your account isn&apos;t recorded as an administrator of an eligible member institution.
            The Executive Director can sort that out.
          </Notice>
        )}
      </ElectionShell>
    );
  }

  const nominator = eligibleNominatorOrgs[0];
  const selected = nomineeId ? await getNominatableContact(election.id, nomineeId) : null;
  const results = !selected && q ? await listNominatableContacts(election.id, q) : [];

  /**
   * Form actions must return void, and a failure has to land somewhere the user
   * can see it — so errors go back into the URL the page already reads rather
   * than being swallowed. Success redirects from inside the action itself.
   */
  async function submit(formData: FormData) {
    "use server";
    const result = await submitNominationAction(slug, formData);
    if (!result.ok) {
      const back = new URLSearchParams({
        nominee: String(formData.get("nomineeContactId") ?? ""),
        error: result.error ?? "That nomination could not be submitted.",
      });
      redirect(`/elections/${slug}/nominate?${back.toString()}`);
    }
  }

  // Step 2 — the person is chosen; work out who has to stand behind it.
  if (selected) {
    const plan = planNomination(election.config, {
      nominatorOrganizationId: nominator.organizationId,
      nominatorOrganizationName: nominator.name,
      nominatorContactId: nominator.contactId,
      nomineeContactId: selected.contactId,
    });
    const candidates = await listCosignerOrganizations(election.id, [
      ...plan.automatic.map((a) => a.organizationId),
      ...(plan.isSelfNomination ? [selected.organizationId] : []),
    ]);

    return (
      <ElectionShell
        eyebrow={eyebrow}
        title={`Nominate ${selected.name}`}
        subtitle={`${selected.organizationName}${selected.roleTitle ? ` · ${selected.roleTitle}` : ""}`}
      >
        <form action={submit} className="space-y-6">
          <input type="hidden" name="nomineeContactId" value={selected.contactId} />
          <input type="hidden" name="nominatorOrganizationId" value={nominator.organizationId} />

          {plan.isSelfNomination ? (
            <Notice tone="info">
              <strong>This is a self-nomination.</strong> Because you cannot co-sign your own
              nomination, it needs <strong>{plan.stillNeeded} other member institutions</strong> to
              stand behind it — one more than nominating a colleague would.
            </Notice>
          ) : (
            <Notice tone="info">
              Your institution counts as one of the {election.config.nominations.cosignersRequired}{" "}
              signatures — putting the name forward is your support. You need{" "}
              <strong>
                {plan.stillNeeded} more institution{plan.stillNeeded === 1 ? "" : "s"}
              </strong>
              .
            </Notice>
          )}

          <fieldset>
            <legend className="text-sm font-medium text-gray-900">
              Ask {plan.stillNeeded === 1 ? "an institution" : `${plan.stillNeeded} institutions`} to
              co-sign
            </legend>
            <p className="mt-1 text-xs text-gray-500">
              We&apos;ll email each one a link. They are agreeing that this name should go in front of
              the members — not agreeing to vote for them.
            </p>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-gray-200">
              {candidates.map((c) => (
                <label
                  key={c.organizationId}
                  className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    name="inviteOrganizationId"
                    value={c.organizationId}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-gray-800">{c.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
            >
              Submit nomination
            </button>
            <Link
              href={`/elections/${slug}/nominate`}
              className="text-sm text-gray-600 underline hover:text-gray-800"
            >
              Choose someone else
            </Link>
          </div>
        </form>
      </ElectionShell>
    );
  }

  // Step 1 — find the person.
  const me = actor.contactIdFor(nominator.organizationId);

  return (
    <ElectionShell
      eyebrow={eyebrow}
      title="Nominate a director"
      subtitle={`${election.seatsAvailable} seats · nominations close ${formatDate(election.schedule.nominationsCloseAt)}`}
    >
      <p className="text-sm text-gray-600">
        Any employee of a member institution in good standing may stand for the board. You can
        nominate a colleague, someone at another institution, or yourself.
      </p>

      <form method="get" className="mt-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#2B2E33] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a1d21]"
        >
          Search
        </button>
      </form>

      {me && (
        <p className="mt-3 text-sm">
          <Link
            href={`/elections/${slug}/nominate?nominee=${me}`}
            className="text-[#B92026] underline hover:text-[#9c1b20]"
          >
            Nominate myself
          </Link>
        </p>
      )}

      {q && results.length === 0 && (
        <div className="mt-6">
          <Notice tone="info">
            Nobody at an eligible member institution matches &ldquo;{q}&rdquo;. Note that people at
            institutions which haven&apos;t completed their renewal don&apos;t appear here yet.
          </Notice>
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-6 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {results.map((r) => (
            <li key={r.contactId}>
              <Link
                href={`/elections/${slug}/nominate?nominee=${r.contactId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-gray-50"
              >
                <span>
                  <span className="font-medium text-gray-900">{r.name}</span>
                  {r.roleTitle && <span className="text-gray-500"> · {r.roleTitle}</span>}
                  <span className="block text-xs text-gray-500">{r.organizationName}</span>
                </span>
                <span className="text-xs text-gray-400">Choose</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ElectionShell>
  );
}
