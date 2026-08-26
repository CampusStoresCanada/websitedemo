/**
 * /admin/elections/[slug]/proxies — the proxy register for the AGM.
 *
 * By-Law Part VII S7. What the chair and the scrutineer need in the room: who is
 * carrying whose vote, on what authority, and what has been withdrawn.
 *
 * Withdrawn appointments are shown rather than hidden. At a contested meeting
 * "this store never appointed anyone" and "this store appointed someone and
 * changed its mind" are different facts, and a register that silently drops the
 * second cannot answer a challenge.
 *
 * Quorum (Part VII S6) is 33% of voting members present in person OR by proxy.
 * This page reports the by-proxy half and says so plainly — it deliberately does
 * not print a quorum figure, because nothing here knows who walked into the
 * room.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { getElection } from "@/lib/elections/service";
import { getProxyRegister } from "@/lib/elections/proxy-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Proxy register | Admin | Campus Stores Canada" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

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

export default async function ProxyRegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const election = await getElection(slug);
  if (!election) notFound();

  const db = createAdminClient();
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id, meeting_date")
    .eq("meeting_type", "agm")
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  const register = meeting?.id
    ? await getProxyRegister(meeting.id, { includeRevoked: true })
    : null;

  const rows = register?.ok ? register.data : [];
  const live = rows.filter((r) => !r.revokedAt);
  const withdrawn = rows.filter((r) => r.revokedAt);

  // The denominator for "how much of the electorate is covered by proxy".
  const { count: votingMembers } = await db
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("type", "Member")
    .in("membership_status", ["active", "reactivated"])
    .eq("is_test", false)
    .is("archived_at", null);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`${election.cycleYear} AGM — proxy register`}
        description={`By-Law Part VII S7. One proxy per member store, valid only for the meeting on ${formatDate(election.schedule.agmDate)}.`}
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={`/admin/elections/${slug}`} className="text-blue-700 hover:underline">
          ← Back to the election
        </Link>
      </div>

      {!meeting?.id ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          There is no AGM meeting record for {election.schedule.agmDate} yet, so no proxy can
          be appointed. The election kickoff creates it.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-2xl font-semibold text-gray-900">{live.length}</p>
              <p className="text-sm text-gray-600">votes held by proxy</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-2xl font-semibold text-gray-900">{votingMembers ?? 0}</p>
              <p className="text-sm text-gray-600">member stores entitled to vote</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-2xl font-semibold text-gray-900">{withdrawn.length}</p>
              <p className="text-sm text-gray-600">withdrawn</p>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Quorum is 33% of member stores entitled to vote, present in person or by proxy
            (Part VII S6). This page counts only the proxies — attendance in the room is not
            recorded here, so the chair still determines quorum at the meeting.
          </p>

          {live.length === 0 ? (
            <div className="rounded-lg border border-gray-200 p-6 text-sm text-gray-600">
              No proxies have been appointed yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Store</th>
                    <th className="px-4 py-2">Proxyholder</th>
                    <th className="px-4 py-2">Holder&apos;s store</th>
                    <th className="px-4 py-2">Signed by</th>
                    <th className="px-4 py-2">Form</th>
                    <th className="px-4 py-2">Appointed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {live.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {p.grantorOrganizationName ?? "—"}
                      </td>
                      <td className="px-4 py-2">{p.proxyholderName ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {p.proxyholderOrganizationName ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-600">{p.grantorContactName ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600">{p.formSource}</td>
                      <td className="px-4 py-2 text-gray-600">{formatWhen(p.signedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {withdrawn.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-900">Withdrawn</h2>
              <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2">Store</th>
                      <th className="px-4 py-2">Was held by</th>
                      <th className="px-4 py-2">Withdrawn</th>
                      <th className="px-4 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {withdrawn.map((p) => (
                      <tr key={p.id} className="text-gray-500">
                        <td className="px-4 py-2">{p.grantorOrganizationName ?? "—"}</td>
                        <td className="px-4 py-2">{p.proxyholderName ?? "—"}</td>
                        <td className="px-4 py-2">
                          {p.revokedAt ? formatWhen(p.revokedAt) : "—"}
                        </td>
                        <td className="px-4 py-2">{p.revocationReason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
