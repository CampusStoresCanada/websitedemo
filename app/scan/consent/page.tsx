import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { loadDisclosuresForUser } from "@/lib/conference/badges/scan";
import { DisclosureDecision } from "@/components/scan/DisclosureDecision";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Who scanned your badge | Campus Stores Canada",
  robots: { index: false },
};

/**
 * The attendee's side of lead capture.
 *
 * The point of the whole design is that this page exists: nobody has to be
 * asked "can I scan you?" in the moment, and nobody has to say no to someone's
 * face. The decision happens here, afterwards, with no one watching.
 *
 * ⛔ A static segment under a dynamic one — Next.js resolves `/scan/consent`
 * here rather than to `/scan/[token]`. Badge tokens are exactly 16 characters,
 * so no token can ever collide with this path.
 */
export default async function ScanConsentPage() {
  const ctx = await getOptionalAuthContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent("/scan/consent")}`);

  const disclosures = await loadDisclosuresForUser(ctx.userId);
  const pending = disclosures.filter((d) => d.status === "pending");
  const decided = disclosures.filter((d) => d.status !== "pending");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Who scanned your badge</h1>
      <p className="mt-2 text-slate-600">
        Exhibitors who scanned you at the conference. Your contact details are not sent to anyone
        until you say so here.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Waiting on you
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-slate-500">Nothing waiting.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4"
              >
                <div>
                  <p className="font-medium text-slate-900">{d.vendorName}</p>
                  <p className="text-sm text-slate-500">
                    Scanned {new Date(d.requestedAt).toLocaleDateString()}
                  </p>
                </div>
                <DisclosureDecision disclosureId={d.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Already decided
          </h2>
          <ul className="mt-3 space-y-2">
            {decided.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3"
              >
                <span className="text-slate-800">{d.vendorName}</span>
                <span className="text-sm text-slate-500">
                  {d.status === "released" ? "Details shared" : "Not shared"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
