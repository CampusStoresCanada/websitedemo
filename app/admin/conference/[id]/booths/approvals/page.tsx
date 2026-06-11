import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getConference } from "@/lib/actions/conference";
import { getBoothApprovals } from "@/lib/actions/conference-booths";
import ApprovalActions from "./approval-actions";

export const metadata = { title: "Admin — Booth Approvals" };

export default async function BoothApprovalsPage({
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
  const approvalsResult = await getBoothApprovals(conference.id);
  const approvals = approvalsResult.data ?? [];

  const pending = approvals.filter((a) => a.status === "pending");
  const approved = approvals.filter((a) => a.status === "approved");
  const historical = approvals.filter((a) => !["pending", "approved"].includes(a.status));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">Booth Purchase Approvals</p>
        </div>
        <Link
          href={`/admin/conference/${id}/booths`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Booth Overview
        </Link>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Two admins must approve each request before the card is charged.
        You cannot be both the first and second approver.
      </div>

      {/* Pending approvals */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Pending Approval ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-500">No pending approvals.</p>
        ) : (
          <div className="space-y-3">
            {pending.map((approval) => (
              <div key={approval.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-900">
                        Booth {approval.booth_number}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {approval.approver_1_id ? "1 of 2 approved" : "Awaiting approval"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        approval.payment_type === "po"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {approval.payment_type === "po" ? "PO" : "Card"}
                      </span>
                    </div>
                    <div className="text-sm text-gray-700">{approval.organization_name}</div>
                    <div className="text-xs text-gray-500">
                      ${(approval.total_cents / 100).toFixed(2)} CAD
                      {approval.po_number && ` · PO: ${approval.po_number}`}
                      {approval.charge_after && ` · Charges ${new Date(
                        approval.charge_after.endsWith("Z") ? approval.charge_after : approval.charge_after.replace(" ", "T") + "Z"
                      ).toLocaleDateString()}`}
                    </div>
                    <div className="text-xs text-gray-400 font-mono">
                      Submitted {new Date(approval.created_at.endsWith("Z") ? approval.created_at : approval.created_at.replace(" ", "T") + "Z").toLocaleString()}
                    </div>
                  </div>
                  <ApprovalActions
                    approvalId={approval.id}
                    approver1Id={approval.approver_1_id}
                    currentAdminId={auth.ctx.userId}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fully approved (awaiting charge) */}
      {approved.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            Approved — Awaiting Charge ({approved.length})
          </h2>
          <div className="space-y-2">
            {approved.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm">
                <div>
                  <span className="font-medium">Booth {a.booth_number}</span>
                  {" · "}
                  <span className="text-gray-700">{a.organization_name}</span>
                  {" · "}
                  <span>${(a.total_cents / 100).toFixed(2)} CAD</span>
                  {a.payment_type === "po" && a.charge_after && (
                    <span className="ml-2 text-xs text-gray-500">
                      Charges {new Date(
                        a.charge_after.endsWith("Z") ? a.charge_after : a.charge_after.replace(" ", "T") + "Z"
                      ).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-medium text-green-800">
                  Approved
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Historical */}
      {historical.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            History ({historical.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Booth</th>
                  <th className="px-4 py-3 text-left">Organization</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {historical.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-mono font-medium">{a.booth_number}</td>
                    <td className="px-4 py-3 text-gray-700">{a.organization_name}</td>
                    <td className="px-4 py-3">${(a.total_cents / 100).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.status === "charged"
                          ? "bg-green-100 text-green-800"
                          : a.status === "rejected" || a.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(a.created_at.endsWith("Z") ? a.created_at : a.created_at.replace(" ", "T") + "Z").toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
