import { applyDiscountPct } from "@/lib/policy/proration";

interface Props {
  vendorRate: number;
  /** Resolved via effectiveProrationDiscountPct — 0 within the pre-renewal skip-stub window. */
  discountPct: number;
}

export default function PartnershipPricingCard({ vendorRate, discountPct }: Props) {
  const livePrice = applyDiscountPct(vendorRate, discountPct);

  return (
    <div className="rounded-2xl border border-[#E5E5E5] bg-white p-6 text-center">
      <p className="text-sm font-medium text-[#6B6B6B]">Vendor Partnership</p>
      <p className="mt-2 text-4xl font-bold tracking-tight text-[#1A1A1A]">${livePrice}</p>
      <p className="text-sm text-[#6B6B6B]">per year, unlimited</p>
    </div>
  );
}
