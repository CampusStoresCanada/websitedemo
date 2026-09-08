import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { loadLeadsForOrganization, resolveScanner } from "@/lib/conference/badges/scan";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your captured leads | Campus Stores Canada",
  robots: { index: false },
};

/**
 * The exhibitor's side of lead capture.
 *
 * A captured lead shows the person and their store immediately — the exhibitor
 * met them, and already has the attendee list. What is withheld until release
 * is the CONTACT DETAIL, and it is withheld in the QUERY, not here: if the
 * address reached this component it would already have been sent to the
 * browser, and "nothing has been sent" would be a lie.
 */
export default async function ScanLeadsPage() {
  const ctx = await getOptionalAuthContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent("/scan/leads")}`);

  const scanner = await resolveScanner(ctx.userId);
  if (!scanner.organizationId) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Your captured leads</h1>
        <p className="mt-2 text-slate-600">
          Your account is not linked to an exhibiting organisation.
        </p>
      </main>
    );
  }

  const leads = await loadLeadsForOrganization(scanner.organizationId);
  const released = leads.filter((l) => l.status === "released");
  const waiting = leads.filter((l) => l.status === "pending");
  const declined = leads.filter((l) => l.status === "declined");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Your captured leads</h1>
      <p className="mt-2 text-slate-600">
        {scanner.organizationName ?? "Your organisation"} · {released.length} shared,{" "}
        {waiting.length} waiting
      </p>

      <Group title="Shared with you" rows={released} showEmail />
      <Group title="Waiting on the attendee" rows={waiting} />
      {declined.length > 0 ? <Group title="Not shared" rows={declined} /> : null}
    </main>
  );
}

function Group({
  title,
  rows,
  showEmail = false,
}: {
  title: string;
  rows: Array<{
    id: string;
    personName: string;
    organizationName: string | null;
    email: string | null;
  }>;
  showEmail?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-slate-500">None.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-slate-200 p-4">
              <p className="font-medium text-slate-900">{row.personName}</p>
              {row.organizationName ? (
                <p className="text-sm text-slate-500">{row.organizationName}</p>
              ) : null}
              {showEmail && row.email ? (
                <p className="mt-1 text-sm text-slate-700">{row.email}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
