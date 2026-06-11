import { redirect, notFound } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBoothSaleContext,
  checkPartnershipStatus,
  getBoothById,
} from "@/lib/actions/conference-booths";
import type { BoothDayRole } from "@/lib/constants/floor-plan";
import BoothPurchaseClient from "./booth-purchase-client";

export const metadata = { title: "Purchase Booth" };

export default async function BoothPurchasePage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string; boothId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { year, edition, boothId } = await params;
  const query = await searchParams;

  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  if (!conferenceResult.success || !conferenceResult.data) notFound();
  const conference = conferenceResult.data;

  const db = createAdminClient();

  // Fetch the booth via typed action (conference_booths not in generated types yet)
  const boothResult = await getBoothById(boothId, conference.id);
  if (!boothResult.success || !boothResult.data) notFound();
  const booth = boothResult.data;

  // Verify the user's org
  const { data: userOrgs } = await db
    .from("user_organizations")
    .select("organization_id, organizations(id, name, type)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const orgs = (userOrgs ?? []).map(
    (row) => (row as unknown as { organizations: { id: string; name: string; type: string | null } }).organizations
  );

  const vendorOrgs = orgs.filter((o) => {
    const t = (o.type ?? "").toLowerCase();
    return t === "vendor_partner" || t === "vendor partner";
  });

  const selectedOrg =
    vendorOrgs.find((o) => o.id === query.org) ?? vendorOrgs[0] ?? null;

  if (!selectedOrg) {
    redirect(`/conference/${year}/${edition}/booths`);
  }

  // Sale window check
  const saleCtxResult = await getBoothSaleContext(conference.id, selectedOrg.id);
  const saleCtx = saleCtxResult.data;
  if (!saleCtx?.canSelect) {
    redirect(`/conference/${year}/${edition}/booths?org=${selectedOrg.id}`);
  }

  // Booth must be available
  if (booth.status !== "available") {
    redirect(`/conference/${year}/${edition}/booths?org=${selectedOrg.id}`);
  }

  // Partnership check
  const partnershipStatus = await checkPartnershipStatus(
    selectedOrg.id,
    parseInt(year, 10)
  );

  const boothProduct =
    conference.conference_products.find((p) => p.id === booth.booth_product_id) ?? null;
  const boothProductPrice = boothProduct?.price_cents ?? 0;

  const partnershipProduct = conference.conference_products.find(
    (p) => p.slug === "annual_partnership_bundle"
  );
  const partnershipFee = partnershipStatus.hasCurrentPartnership
    ? 0
    : (partnershipProduct?.price_cents ?? 0);
  const subtotalCents = boothProductPrice + partnershipFee;

  // Tax — use conference tax rate if available
  const taxRatePct = (conference as unknown as { tax_rate_pct?: number | null }).tax_rate_pct ?? 0;
  const taxCents = Math.round(subtotalCents * (taxRatePct / 100));
  const totalCents = subtotalCents + taxCents;

  const lineItems = [
    ...(partnershipFee > 0
      ? [{ slug: "annual_partnership_bundle", name: "CSC Annual Partnership (2026–27)", amount_cents: partnershipFee }]
      : []),
    {
      slug: boothProduct?.slug ?? "exhibitor_booth",
      name: boothProduct?.name ?? "Exhibitor Booth",
      amount_cents: boothProductPrice,
      booth_number: booth.booth_number,
      booth_id: booth.id,
    },
  ];

  const dayPattern = (boothProduct?.metadata as Record<string, unknown> | null)?.day_pattern as
    | Record<string, BoothDayRole[]>
    | undefined;
  const hasMeetingDay = Object.values(dayPattern ?? {}).some((roles) => roles.includes("meeting"));

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <a
          href={`/conference/${year}/${edition}/booths?org=${selectedOrg.id}`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to floor plan
        </a>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          Booth {booth.booth_number}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {boothProduct?.name ?? "Unassigned"} · {conference.name}
        </p>
      </div>

      {/* Order summary */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
        <h2 className="font-semibold text-gray-900">Order Summary</h2>
        <div className="mt-3 space-y-2">
          {lineItems.map((item, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-gray-700">{item.name}</span>
              <span className="font-medium">
                ${(item.amount_cents / 100).toFixed(2)}
              </span>
            </div>
          ))}
          {taxCents > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Tax ({taxRatePct}%)</span>
              <span>${(taxCents / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold">
            <span>Total</span>
            <span>${(totalCents / 100).toFixed(2)} CAD</span>
          </div>
        </div>
        {partnershipStatus.hasCurrentPartnership && (
          <p className="mt-2 text-xs text-green-700">
            Partnership fee waived — your 2026–27 membership is active.
          </p>
        )}
      </div>

      {/* Included with booth */}
      <div className="rounded-lg border border-gray-200 p-4 text-sm">
        <h2 className="font-semibold text-gray-900 mb-2">What&apos;s Included</h2>
        <ul className="space-y-1 text-gray-600 text-xs list-disc list-inside">
          <li>8&apos;×10&apos; booth space with 6&apos;×2&apos; table and two chairs</li>
          <li>Meals during trade show hours (including breakfast)</li>
          <li>One networking session pass (additional passes $200/person)</li>
          <li>First 2 staff members included free</li>
          {hasMeetingDay && (
            <li className="text-blue-700 font-medium">
              Includes pre-scheduled meeting day(s)
            </li>
          )}
        </ul>
      </div>

      {/* Payment form */}
      <BoothPurchaseClient
        boothId={booth.id}
        boothNumber={booth.booth_number}
        orgId={selectedOrg.id}
        orgName={selectedOrg.name}
        conferenceId={conference.id}
        year={year}
        edition={edition}
        lineItems={lineItems}
        subtotalCents={subtotalCents}
        taxCents={taxCents}
        totalCents={totalCents}
      />
    </main>
  );
}
