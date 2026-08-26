/**
 * /elections/[slug]/proxy — appoint someone to carry your store's vote.
 *
 * By-Law Part VII S7. The appointment belongs to the STORE, like the ballot, and
 * any of its administrators may make or change it until the meeting.
 *
 * The page states the eligibility rule up front rather than only enforcing it in
 * the picker, because the rule is genuinely surprising: a proxyholder from
 * another store must be that store's PRIMARY contact, not merely someone who
 * works there. A member who does not know that reads a short list as a bug.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerAuthState } from "@/lib/auth/server";
import { getProxyState } from "@/lib/elections/proxy-service";
import { ElectionShell, Notice, SignInPrompt } from "@/components/elections/ElectionShell";
import { appointProxyAction, revokeProxyAction } from "@/lib/actions/elections";

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
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default async function ProxyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ org?: string; error?: string; saved?: string; withdrawn?: string }>;
}) {
  const { slug } = await params;
  const { org, error, saved, withdrawn } = await searchParams;

  const auth = await getServerAuthState();
  if (!auth.user)
    return <SignInPrompt returnTo={`/elections/${slug}/proxy`} action="appoint a proxy" />;

  const state = await getProxyState(slug, auth.user.id, auth.organizations, org);
  if (!state) {
    return (
      <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Election not found">
        <p className="text-sm text-gray-600">That election doesn&apos;t exist.</p>
      </ElectionShell>
    );
  }

  const { election, meetingId, eligibleOrganizations, organization, blocked, candidates, current } =
    state;
  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Annual General Meeting`;
  const agmOn = formatDate(election.agmDate);

  if (blocked || !organization) {
    return (
      <ElectionShell eyebrow={eyebrow} title="You cannot appoint a proxy">
        <Notice tone="warning">
          {blocked ?? "You do not administer a member store."}
        </Notice>
      </ElectionShell>
    );
  }

  if (!meetingId) {
    return (
      <ElectionShell eyebrow={eyebrow} title="Not open yet">
        <Notice tone="info">
          The {election.cycleYear} annual general meeting on {agmOn} has not been set up yet.
          Proxy appointments open once it is.
        </Notice>
      </ElectionShell>
    );
  }

  async function appoint(formData: FormData) {
    "use server";
    const result = await appointProxyAction(slug, formData);
    const back = new URLSearchParams({ org: String(formData.get("organizationId") ?? "") });
    if (!result.ok) back.set("error", result.error ?? "That proxy could not be recorded.");
    else back.set("saved", "1");
    redirect(`/elections/${slug}/proxy?${back.toString()}`);
  }

  async function withdraw(formData: FormData) {
    "use server";
    const result = await revokeProxyAction(slug, formData);
    const back = new URLSearchParams({ org: String(formData.get("organizationId") ?? "") });
    if (!result.ok) back.set("error", result.error ?? "That proxy could not be withdrawn.");
    else back.set("withdrawn", "1");
    redirect(`/elections/${slug}/proxy?${back.toString()}`);
  }

  return (
    <ElectionShell eyebrow={eyebrow} title="Appoint a proxy">
      {error && <Notice tone="warning">{error}</Notice>}
      {saved && <Notice tone="success">Your proxy has been recorded.</Notice>}
      {withdrawn && <Notice tone="success">That proxy has been withdrawn.</Notice>}

      <p className="text-sm text-gray-700">
        If nobody from {organization.name} can attend the annual general meeting on{" "}
        <strong>{agmOn}</strong>, you can appoint someone to attend and vote on your behalf.
        The appointment covers every question put to that meeting, including the board
        election.
      </p>

      <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <p className="font-medium text-gray-900">Who you can appoint</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Anyone who works at {organization.name}, or</li>
          <li>
            the <strong>primary contact</strong> of another member store — not any employee
            of that store, only the person it has named as its primary contact.
          </li>
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          By-Law No. 1, Part VII, Section 7. A proxy is good for this meeting only, and you
          can change or withdraw it any time before it starts.
        </p>
      </div>

      {eligibleOrganizations.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {eligibleOrganizations.map((o) => (
            <Link
              key={o.id}
              href={`/elections/${slug}/proxy?org=${o.id}`}
              className={
                o.id === organization.id
                  ? "rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white"
                  : "rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              }
            >
              {o.name}
            </Link>
          ))}
        </div>
      )}

      {current ? (
        <div className="mt-6 rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-900">
            {current.proxyholderName ?? "Someone"} is carrying {organization.name}&apos;s vote
          </p>
          <p className="mt-1 text-sm text-green-800">
            {current.proxyholderOrganizationName ?? "Unknown store"} · appointed{" "}
            {formatWhen(current.signedAt)}
            {current.formSource !== "online" && ` · recorded from a ${current.formSource} form`}
          </p>
          <form action={withdraw} className="mt-3">
            <input type="hidden" name="proxyId" value={current.id} />
            <input type="hidden" name="organizationId" value={organization.id} />
            <input type="hidden" name="meetingId" value={meetingId} />
            <button
              type="submit"
              className="rounded-md border border-green-700 px-3 py-1.5 text-sm font-medium text-green-900 hover:bg-green-100"
            >
              Withdraw this proxy
            </button>
          </form>
        </div>
      ) : null}

      <form action={appoint} className="mt-6 space-y-4">
        <input type="hidden" name="organizationId" value={organization.id} />
        <input type="hidden" name="meetingId" value={meetingId} />

        <div>
          <label htmlFor="proxyholderContactId" className="block text-sm font-medium text-gray-900">
            {current ? "Appoint someone else instead" : "Who will carry your vote?"}
          </label>
          <select
            id="proxyholderContactId"
            name="proxyholderContactId"
            required
            defaultValue=""
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a person…
            </option>
            {candidates.map((c) => (
              <option key={c.contactId} value={c.contactId}>
                {c.name ?? "Unnamed contact"} — {c.organizationName ?? "Unknown store"}
                {c.eligibility.route === "own_store" ? " (your store)" : ""}
              </option>
            ))}
          </select>
          {candidates.length === 0 && (
            <p className="mt-2 text-sm text-gray-600">
              Nobody is currently eligible to hold your proxy. That usually means no other
              member store has a primary contact on file — tell the CSC office and they can
              sort it out.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={candidates.length === 0}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {current ? "Replace proxy" : "Appoint proxy"}
        </button>
      </form>
    </ElectionShell>
  );
}
