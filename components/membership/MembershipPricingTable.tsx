import { currentProrationDiscountPct, applyDiscountPct } from "@/lib/policy/proration";
import type { ProrationRule } from "@/lib/stripe/types";

interface FormulaConfig {
  base: number;
  multiplier: number;
  min_price: number;
  max_price: number;
  rounding: "nearest_dollar" | "floor" | "ceil";
}

interface Props {
  pricingMode: string;
  membershipTiers: Array<{ max_fte: number | null; price: number }>;
  formulaConfig: FormulaConfig | null;
  prorationRules: ProrationRule[];
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })}`;
}

function formatFte(value: number): string {
  return value.toLocaleString("en-CA");
}

export default function MembershipPricingTable({
  pricingMode,
  membershipTiers,
  formulaConfig,
  prorationRules,
}: Props) {
  const isFormula = pricingMode === "LINEAR_FORMULA";
  const discountPct = currentProrationDiscountPct(prorationRules);

  if (isFormula && formulaConfig) {
    return (
      <p className="mt-8 text-center text-sm text-[#6B6B6B] max-w-lg mx-auto">
        Pricing scales with FTE: a base rate plus a per-FTE amount, bounded between{" "}
        {formatDollars(formulaConfig.min_price * 100)} and {formatDollars(formulaConfig.max_price * 100)} per year.
      </p>
    );
  }

  const sortedTiers = [...membershipTiers].sort((a, b) => {
    if (a.max_fte === null) return 1;
    if (b.max_fte === null) return -1;
    return a.max_fte - b.max_fte;
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white text-left">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#FAFAFA] text-left text-[#6B6B6B]">
            <th className="px-5 py-3 font-medium">Institution size</th>
            <th className="px-5 py-3 font-medium text-right">Annual fee</th>
          </tr>
        </thead>
        <tbody>
          {sortedTiers.map((tier, idx) => {
            const lowerBound = idx === 0 ? 0 : (sortedTiers[idx - 1].max_fte ?? 0) + 1;
            const label =
              tier.max_fte === null
                ? `${formatFte(lowerBound)}+ FTE`
                : idx === 0
                  ? `Up to ${formatFte(tier.max_fte)} FTE`
                  : `${formatFte(lowerBound)}–${formatFte(tier.max_fte)} FTE`;
            const livePrice = applyDiscountPct(tier.price, discountPct);
            return (
              <tr key={tier.max_fte ?? "open"} className={idx % 2 === 1 ? "bg-[#FAFAFA]" : "bg-white"}>
                <td className="px-5 py-3 text-[#1A1A1A]">{label}</td>
                <td className="px-5 py-3 text-right font-medium text-[#1A1A1A]">
                  {formatDollars(livePrice * 100)}/yr
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
