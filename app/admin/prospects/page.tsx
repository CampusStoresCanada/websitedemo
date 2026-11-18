import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { getProspectCallList } from "@/lib/renewal/call-list";
import { resolveBoardRenewalWindow } from "@/lib/renewal/board-report";
import CallList from "@/components/renewals/CallList";
import AddProspectCompany from "@/components/admin/AddProspectCompany";
import { loginWithNext } from "@/lib/auth/login-redirect";

export const metadata = { title: "Prospects | Campus Stores Canada" };

/**
 * Stores and vendors we would like to have. My renewal calls, for people who
 * have never joined: the same rows, the same "Log a call", the same contact
 * log, so a prospect who joins keeps the record of how they were recruited.
 * Shared, not assigned: anyone on staff can pick one up.
 */
export default async function ProspectsPage() {
  const auth = await requireAdmin();
  if (!auth.ok) redirect(loginWithNext("/admin/prospects"));

  // Calls are logged against a cycle, the same one My renewal calls uses.
  const today = new Date().toISOString().slice(0, 10);
  const window = await resolveBoardRenewalWindow(today);
  const renewalYear = window?.renewalYear ?? new Date().getUTCFullYear() + 1;

  const { partners, members } = await getProspectCallList(renewalYear);
  const sections = [
    { title: "Prospective partners", empty: "No prospective partners yet.", list: partners },
    { title: "Prospective members", empty: "No prospective members yet.", list: members },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-[#163D6D] mt-2">Prospects</h1>
          <p className="text-sm text-gray-500 mt-1">
            Stores and vendors we would like to have. Visible to CSC staff only.
          </p>
        </div>
        <AddProspectCompany />
      </div>

      <div className="space-y-8">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              {s.title}
              {s.list.entries.length > 0 && (
                <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                  {s.list.contactedCount} of {s.list.entries.length} contacted
                </span>
              )}
            </h2>
            <div className="mt-3">
              {s.list.entries.length === 0 ? (
                <p className="rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">{s.empty}</p>
              ) : (
                <CallList list={s.list} />
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
