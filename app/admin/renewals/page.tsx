import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { getRenewalCallList } from "@/lib/renewal/call-list";
import { resolveBoardRenewalWindow } from "@/lib/renewal/board-report";
import CallList from "@/components/renewals/CallList";

export const metadata = { title: "My renewal calls | Campus Stores Canada" };

export default async function RenewalCallListPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect("/login");

  // The cycle is whichever one today's date sits in for board reporting. Using
  // the same resolver as the board tab keeps the two surfaces talking about the
  // same year rather than each deriving it their own way.
  const today = new Date().toISOString().slice(0, 10);
  const window = await resolveBoardRenewalWindow(today);
  const renewalYear = window?.renewalYear ?? new Date().getUTCFullYear() + 1;

  const list = await getRenewalCallList(auth.ctx.userId, renewalYear);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-[#163D6D] mt-2">My renewal calls</h1>
        <p className="text-sm text-gray-500 mt-1">
          {list.entries.length === 0
            ? `Nothing is assigned to you for ${renewalYear - 1}-${String(renewalYear).slice(2)}.`
            : `${list.contactedCount} of ${list.outstandingCount} spoken to · ` +
              `${renewalYear - 1}-${String(renewalYear).slice(2)} cycle`}
        </p>
      </div>

      {list.entries.length === 0 ? (
        <div className="rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-600">
            Renewal calls are handed out from the Renewals tab on a board meeting.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Once someone assigns you a store, it appears here with their contact details.
          </p>
        </div>
      ) : (
        <CallList list={list} />
      )}
    </div>
  );
}
