import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getConference } from "@/lib/actions/conference";
import { getAdminBoothOverview } from "@/lib/actions/conference-booths";
import type { BoothStatus } from "@/lib/actions/conference-booths";
import { getBoothPackagesFromProducts } from "@/lib/constants/floor-plan";

export const metadata = { title: "Admin — Booth Overview" };

const STATUS_BADGE: Record<BoothStatus, string> = {
  available:    "bg-green-100 text-green-800",
  sponsor_hold: "bg-orange-100 text-orange-800",
  reserved:     "bg-yellow-100 text-yellow-800",
  sold:         "bg-red-100 text-red-800",
  waitlisted:   "bg-gray-100 text-gray-800",
};

const STATUS_LABEL: Record<BoothStatus, string> = {
  available:    "Available",
  sponsor_hold: "Sponsor Hold",
  reserved:     "Reserved",
  sold:         "Sold",
  waitlisted:   "Waitlisted",
};

export default async function AdminBoothOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const auth = await requireAdmin();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getConference(id);
  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-600">Conference not found.</p>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const boothsResult = await getAdminBoothOverview(conference.id);
  const booths = boothsResult.data ?? [];

  const byStatus = (s: BoothStatus) => booths.filter((b) => b.status === s).length;
  const boothPackages = getBoothPackagesFromProducts(conference.conference_products);
  const unassigned = booths.filter((b) => !b.booth_product_id);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">Booth Overview</p>
        </div>
        <Link
          href={`/admin/conference/${id}/booths/approvals`}
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
        >
          Pending Approvals
        </Link>
      </div>

      {/* Status summary */}
      <div className="grid gap-3 sm:grid-cols-5 text-center text-sm">
        {(["available", "sponsor_hold", "reserved", "sold", "waitlisted"] as BoothStatus[]).map((s) => (
          <div key={s} className="rounded-lg border border-gray-200 p-3">
            <div className="text-2xl font-bold text-gray-900">{byStatus(s)}</div>
            <div className="text-xs text-gray-500 mt-0.5">{STATUS_LABEL[s]}</div>
          </div>
        ))}
      </div>

      {/* Booth packages */}
      {boothPackages.map((pkg) => (
        <BoothPackageTable
          key={pkg.id}
          title={pkg.name}
          booths={booths.filter((b) => b.booth_product_id === pkg.id)}
          conferenceId={id}
        />
      ))}

      {/* Unassigned booths */}
      {unassigned.length > 0 && (
        <BoothPackageTable
          title="Unassigned"
          booths={unassigned}
          conferenceId={id}
        />
      )}
    </main>
  );
}

function BoothPackageTable({
  title,
  booths,
  conferenceId,
}: {
  title: string;
  booths: { id: string; booth_number: string; status: BoothStatus; organization_name?: string | null; reserved_until?: string | null; sold_at?: string | null }[];
  conferenceId: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-gray-900">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left w-24">Booth #</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Organization</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {booths.map((booth) => (
              <tr key={booth.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium text-gray-900">
                  {booth.booth_number}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[booth.status]}`}>
                    {STATUS_LABEL[booth.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {booth.organization_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {booth.status === "sold" && booth.sold_at
                    ? new Date(booth.sold_at.endsWith("Z") ? booth.sold_at : booth.sold_at.replace(" ", "T") + "Z").toLocaleDateString()
                    : booth.status === "reserved" && booth.reserved_until
                    ? `Until ${new Date(booth.reserved_until.endsWith("Z") ? booth.reserved_until : booth.reserved_until.replace(" ", "T") + "Z").toLocaleTimeString()}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {booth.status !== "available" && (
                    <Link
                      href={`/admin/conference/${conferenceId}/booths/approvals`}
                      className="text-xs text-[#EE2A2E] hover:underline"
                    >
                      View →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
