/**
 * /elections/[slug]/ballot — one institution's ballot.
 *
 * The ballot belongs to the INSTITUTION, not the person filling it in. Any of
 * its administrators may open it and revise it until the close, and the last
 * save wins. That is not a conflict to prevent — member stores insisted on
 * running several administrators, and two of them touching one ballot is the
 * expected case. What would be unacceptable is a SILENT overwrite, so the page
 * always names who saved last and when.
 *
 * Nothing here is anonymous yet. `organization_id` sits on the ballot the whole
 * time it is open, because both the one-per-institution rule and the co-editing
 * depend on it. Anonymity arrives at the seal, which strips the link — and the
 * page says so plainly rather than implying secrecy it does not yet have.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import { getBallotState } from "@/lib/elections/service";
import { describeLastEdit } from "@/lib/elections/ballot";
import { ElectionShell, Notice, SignInPrompt } from "@/components/elections/ElectionShell";
import { saveBallotAction } from "@/lib/actions/elections";

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

/** Stored UTC; the association runs on Mountain time. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Edmonton",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default async function BallotPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ org?: string; error?: string; saved?: string }>;
}) {
  const { slug } = await params;
  const { org, error, saved } = await searchParams;

  const auth = await getServerAuthState();
  if (!auth.user)
    return <SignInPrompt returnTo={`/elections/${slug}/ballot`} action="cast your institution's ballot" />;

  const state = await getBallotState(slug, auth.user.id, auth.organizations, org);
  if (!state) {
    return (
      <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Election not found">
        <p className="text-sm text-gray-600">That election doesn&apos;t exist.</p>
      </ElectionShell>
    );
  }

  const { election, candidates, organization, otherOrganizations, selections, abstain, hasVoted, open, blocked } =
    state;
  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Board election`;

  if (blocked) {
    return (
      <ElectionShell eyebrow={eyebrow} title="You cannot vote on this ballot">
        <Notice tone="warning">{blocked}</Notice>
      </ElectionShell>
    );
  }

  if (election.outcome === "acclaimed") {
    return (
      <ElectionShell eyebrow={eyebrow} title="No ballot this year">
        <Notice tone="info">
          {candidates.length} nominee{candidates.length === 1 ? " was" : "s were"} put forward for{" "}
          {election.seatsAvailable} seats, so there is nothing to vote on — the nominees are
          acclaimed at the annual general meeting on {formatDate(election.schedule.agmDate)}.
        </Notice>
      </ElectionShell>
    );
  }

  if (!open) {
    return (
      <ElectionShell eyebrow={eyebrow} title="Voting is not open">
        <Notice tone="info">
          Ballots for the {election.cycleYear} board run{" "}
          {formatDate(election.schedule.ballotsOpenAt)} to{" "}
          {formatDate(election.schedule.ballotsCloseAt)}.
        </Notice>
      </ElectionShell>
    );
  }

  async function save(formData: FormData) {
    "use server";
    const result = await saveBallotAction(slug, formData);
    const back = new URLSearchParams({ org: String(formData.get("organizationId") ?? "") });
    if (!result.ok) back.set("error", result.error ?? "That ballot could not be saved.");
    else back.set("saved", "1");
    redirect(`/elections/${slug}/ballot?${back.toString()}`);
  }

  const lastEdit = describeLastEdit(state.lastEditedByName, state.lastEditedAt, formatWhen);

  return (
    <ElectionShell
      eyebrow={eyebrow}
      title={`Ballot for ${organization!.name}`}
      subtitle={`Choose up to ${election.seatsAvailable} · closes ${formatDate(election.schedule.ballotsCloseAt)}`}
    >
      {otherOrganizations.length > 0 && (
        <div className="mb-6">
          <Notice tone="info">
            You administer more than one member institution. This is{" "}
            <strong>{organization!.name}</strong>&apos;s ballot — each institution has its own.{" "}
            {otherOrganizations.map((o) => (
              <Link key={o.id} href={`/elections/${slug}/ballot?org=${o.id}`} className="underline">
                Switch to {o.name}
              </Link>
            ))}
          </Notice>
        </div>
      )}

      {saved && (
        <div className="mb-6">
          <Notice tone="success">
            <strong>Ballot saved.</strong> You can change it until{" "}
            {formatDate(election.schedule.ballotsCloseAt)}.
          </Notice>
        </div>
      )}

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {/* Two admins on one ballot is expected, so the risk is a quiet overwrite
          rather than a conflict. Naming the last editor is the mitigation. */}
      {hasVoted && lastEdit && (
        <div className="mb-6">
          <Notice tone="info">
            {lastEdit}
            {state.editCount > 0 &&
              ` This ballot has been revised ${state.editCount} time${state.editCount === 1 ? "" : "s"}.`}
          </Notice>
        </div>
      )}

      <p className="text-sm text-gray-600">
        {organization!.name} has <strong>one vote</strong>, however many administrators it has. Any
        of you can open this page and change the ballot until it closes.
      </p>

      <form action={save} className="mt-6 space-y-6">
        <input type="hidden" name="organizationId" value={organization!.id} />

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-gray-900">
            Candidates ({candidates.length}) — choose up to {election.seatsAvailable}
          </legend>
          {candidates.map((c) => (
            <label
              key={c.nominationId}
              className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                name="selections"
                value={c.nominationId}
                defaultChecked={selections.includes(c.nominationId)}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <span className="min-w-0">
                <span className="block font-medium text-gray-900">{c.displayName}</span>
                <span className="block text-sm text-gray-600">{c.organizationName}</span>
                {c.bio && <span className="mt-2 block whitespace-pre-line text-sm text-gray-700">{c.bio}</span>}
                {c.platform && (
                  <span className="mt-2 block whitespace-pre-line text-sm text-gray-700">
                    <span className="font-medium">Why vote for me: </span>
                    {c.platform}
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="abstain"
              value="1"
              defaultChecked={abstain}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>
              <span className="font-medium text-gray-900">Abstain</span>
              <span className="block text-gray-600">
                Record that {organization!.name} took part without endorsing anyone. An abstention
                does not count toward any candidate, and ticking it discards any selections above.
              </span>
            </span>
          </label>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-[#B92026] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#9c1b20]"
        >
          {hasVoted ? "Update ballot" : "Cast ballot"}
        </button>
      </form>

      <p className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500">
        Ballots close {formatDate(election.schedule.ballotsCloseAt)}. After they close the link
        between this ballot and {organization!.name} is permanently removed — the record will show
        that your institution voted, never how.
      </p>
    </ElectionShell>
  );
}
