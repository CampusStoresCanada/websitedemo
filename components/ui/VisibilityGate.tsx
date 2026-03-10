import BlurredField from "./BlurredField";
import JoinCTA from "./JoinCTA";
import { getBillingConfig } from "@/lib/policy/engine";

interface VisibilityGateProps {
  /**
   * Whether this field is visible to the current viewer.
   * Pre-computed server-side — no useAuth() needed.
   */
  visible: boolean;
  /** The actual content to render when visible */
  children: React.ReactNode;
  /** Masked teaser value (e.g., "J. D.", "@school.ca") when not visible */
  maskedValue?: string | null;
  /** Placeholder dot width when no masked value (default: 8) */
  placeholderWidth?: number;
  /** Whether to show a join CTA alongside the blurred content */
  showCta?: boolean;
  /** Fallback text when value is null even for authorized viewers */
  fallback?: string;
}

async function getPricingCtaText(): Promise<string> {
  try {
    const billing = await getBillingConfig();
    const tiers = billing.membership_tiers ?? [];
    const prices = tiers
      .map((tier) => Number(tier.price))
      .filter((value) => Number.isFinite(value));
    if (prices.length === 0) return "Join CSC";
    const minPrice = Math.min(...prices);
    return `Join CSC ($${minPrice}/year)`;
  } catch {
    return "Join CSC";
  }
}

/**
 * Field-level visibility gate. Renders content normally when visible,
 * or shows a masked teaser / blur placeholder when not visible.
 *
 * Unlike GreyBlur/ProtectedSection, this component:
 * - Does NOT call useAuth() — visibility is pre-determined server-side
 * - Receives already-masked data — no PII in the component tree
 * - Is server-component compatible (no "use client")
 */
export default async function VisibilityGate({
  visible,
  children,
  maskedValue,
  placeholderWidth = 8,
  showCta = false,
  fallback = "—",
}: VisibilityGateProps) {
  if (visible) {
    return <>{children ?? fallback}</>;
  }

  // Not visible — show masked teaser or placeholder
  const ctaText = showCta ? await getPricingCtaText() : null;

  return (
    <span className="inline-flex items-center gap-2">
      <BlurredField
        maskedValue={maskedValue}
        placeholderWidth={placeholderWidth}
      />
      {showCta ? <JoinCTA compact ctaText={ctaText ?? undefined} /> : null}
    </span>
  );
}
