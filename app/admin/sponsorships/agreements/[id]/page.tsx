import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SponsorStatusBadge from "@/components/admin/sponsorships/SponsorStatusBadge";
import AgreementControls from "@/components/admin/sponsorships/AgreementControls";
import PlacementsManager from "@/components/admin/sponsorships/PlacementsManager";
import {
  getSponsorAgreement,
  listPlacementsForAgreement,
  listPlacementSlots,
  getResolvedBenefitsForAgreement,
} from "@/lib/actions/sponsorship";
import { BENEFIT_REGISTRY } from "@/lib/sponsorship/types";
import type { BenefitKey } from "@/lib/sponsorship/types";

export const metadata: Metadata = {
  title: "Agreement | Sponsorships | Admin | Campus Stores Canada",
};

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) return <div className="p-8 text-gray-500">Access denied.</div>;

  const { id } = await params;

  const [agreementResult, placementsResult, slotsResult, benefitsResult] = await Promise.all([
    getSponsorAgreement(id),
    listPlacementsForAgreement(id),
    listPlacementSlots(false),
    getResolvedBenefitsForAgreement(id),
  ]);

  if (!agreementResult.success) notFound();

  const agreement = agreementResult.data;
  const placements = placementsResult.success ? placementsResult.data : [];
  const slots = slotsResult.success ? slotsResult.data : [];
  const benefits = benefitsResult.success ? benefitsResult.data : null;

  const tierColor = agreement.tier?.color ?? "#ccc";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/admin/sponsorships?tab=agreements" className="hover:text-gray-700 transition-colors">
          Sponsorships
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{agreement.organization?.name}</span>
      </nav>

      <AdminPageHeader
        title={agreement.organization?.name ?? "Agreement"}
        description={`${agreement.tier?.name} · ${agreement.start_date} → ${agreement.end_date}`}
      />

      {/* Status + tier */}
      <div className="flex items-center gap-3">
        <SponsorStatusBadge status={agreement.status} />
        <span
          className="text-sm font-semibold px-3 py-1 rounded-full text-white"
          style={{ backgroundColor: tierColor }}
        >
          {agreement.tier?.name}
        </span>
        {agreement.signed_at && (
          <span className="text-xs text-gray-400">
            Signed {new Date(agreement.signed_at).toLocaleDateString("en-CA")}
          </span>
        )}
      </div>

      {/* Status controls */}
      <AgreementControls agreementId={id} currentStatus={agreement.status} />

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-5">
        {/* Left — placements (2 cols) */}
        <div className="col-span-2 rounded-xl border border-gray-200 bg-white p-5">
          <PlacementsManager
            agreementId={id}
            placements={placements}
            availableSlots={slots}
            orgLogoUrl={agreement.organization?.logo_url}
            orgWebsite={agreement.organization?.website}
          />
        </div>

        {/* Right — details + benefits (1 col) */}
        <div className="space-y-4">
          {/* Agreement details */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Details</p>

            <div>
              <p className="text-xs text-gray-400">Organization</p>
              <Link
                href={`/org/${agreement.organization?.slug}`}
                className="text-sm font-medium text-accent hover:underline"
                target="_blank"
              >
                {agreement.organization?.name}
              </Link>
            </div>

            <div>
              <p className="text-xs text-gray-400">Period</p>
              <p className="text-sm text-gray-700">{agreement.start_date}</p>
              <p className="text-sm text-gray-700">→ {agreement.end_date}</p>
            </div>

            {agreement.signed_doc_url && (
              <div>
                <p className="text-xs text-gray-400">Signed agreement</p>
                <a
                  href={agreement.signed_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  View document ↗
                </a>
              </div>
            )}

            {agreement.notes && (
              <div>
                <p className="text-xs text-gray-400">Notes</p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{agreement.notes}</p>
              </div>
            )}
          </div>

          {/* Resolved benefits */}
          {benefits && benefits.all.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Benefits ({benefits.all.length})
              </p>
              <div className="space-y-1.5">
                {benefits.all.map((b) => {
                  const def = BENEFIT_REGISTRY[b.key as BenefitKey];
                  return (
                    <div key={b.key} className="flex items-center gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      <span className="text-gray-700 leading-tight">{def?.label ?? b.label}</span>
                      {b.config?.count != null && (
                        <span className="ml-auto text-xs text-gray-400 shrink-0">×{b.config.count as number}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {(agreement.custom_benefits?.length ?? 0) > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">
                  Includes {agreement.custom_benefits!.length} custom benefit override{agreement.custom_benefits!.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
