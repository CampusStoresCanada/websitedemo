import Link from "next/link";

export const metadata = { title: "Integrations | Admin" };

export default function IntegrationsAdminPage() {
  return (
    <main>
      <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
      <p className="mt-2 text-sm text-gray-600">
        Manage external service connections and sync status.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/circle"
          className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-900">Circle Community</h2>
          <p className="mt-1 text-sm text-gray-600">SSO cutover, member mapping, and sync controls.</p>
        </Link>
        <Link
          href="/admin/ops"
          className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-900">Ops Health</h2>
          <p className="mt-1 text-sm text-gray-600">Monitor Stripe, QuickBooks, and system job status.</p>
        </Link>
        <Link
          href="/admin/policy"
          className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
        >
          <h2 className="text-base font-semibold text-gray-900">Integration Policy</h2>
          <p className="mt-1 text-sm text-gray-600">Configure source-of-truth, conflict rules, and feature flags.</p>
        </Link>
      </div>
    </main>
  );
}
