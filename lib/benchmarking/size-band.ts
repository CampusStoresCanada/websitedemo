import { getEffectivePolicies } from "@/lib/policy/engine";
import type { BillingConfig } from "@/lib/policy/types";

/**
 * Which size band a store compares in (the size-band rule).
 *
 * DERIVED FROM THE DUES TIERS, NOT A SECOND LIST. The boundaries already exist
 * as `billing.membership_tiers` in policy — 2,500 / 5,000 / 10,000 / 20,000 FTE
 * — and they are the ones the association has already agreed to, argued about
 * and published. Inventing a separate set of benchmarking boundaries would mean
 * two definitions of "a store like mine" that start out agreeing and quietly
 * stop, and the day the board moves a dues boundary is the day they would
 * disagree without anyone noticing.
 *
 * Reading the policy also means an admin editing tiers in /admin/policy moves
 * the comparison bands with them. There is nothing to keep in step by hand.
 *
 * PRICE IS NEVER RENDERED. The bands come from the pricing table, but what a
 * peer pays in dues is not part of a benchmarking report — a member reading
 * "stores paying $735" learns something true about other stores' invoices that
 * they were never shown these figures to learn. Only the FTE range is shown.
 */

export interface SizeBand {
  /** Stable key for the cut. */
  key: string;
  /** What the member is shown, e.g. "5,001–10,000 FTE". Never a price. */
  label: string;
  /** Inclusive lower bound. */
  minFte: number;
  /** Inclusive upper bound; null on the open-ended top band. */
  maxFte: number | null;
}

const fmt = (n: number) => n.toLocaleString("en-CA");

/**
 * The bands, in ascending order.
 *
 * Sorted with the open-ended tier last, matching how evaluateBucketPrice
 * normalizes the same array — so a store lands in the band whose dues it pays,
 * not merely one with similar numbers.
 */
export function sizeBandsFromTiers(
  tiers: BillingConfig["membership_tiers"],
): SizeBand[] {
  const sorted = [...(tiers ?? [])].sort((a, b) => {
    if (a.max_fte === null || a.max_fte === undefined) return 1;
    if (b.max_fte === null || b.max_fte === undefined) return -1;
    return a.max_fte - b.max_fte;
  });

  let floor = 0;
  return sorted.map((t, i) => {
    const maxFte = t.max_fte ?? null;
    const minFte = floor;
    floor = maxFte === null ? floor : maxFte + 1;

    // `code` ("XS"–"XL") is an optional admin-facing label on the tier. Prefer
    // it when set so the board's own naming wins, and fall back to the range.
    const label =
      t.code ??
      (maxFte === null
        ? `${fmt(minFte)}+ FTE`
        : minFte === 0
          ? `Under ${fmt(maxFte + 1)} FTE`
          : `${fmt(minFte)}–${fmt(maxFte)} FTE`);

    return { key: `band-${i + 1}`, label, minFte, maxFte };
  });
}

/**
 * Which band a given FTE falls in.
 *
 * Inclusive upper bound, the same `<=` test evaluateBucketPrice uses. A store
 * with exactly 10,000 FTE pays the 10,000 tier, so it compares in the 10,000
 * band; an off-by-one here would put a store in a band it does not pay in and
 * nobody would ever spot it.
 */
export function resolveSizeBand(
  fte: number | null | undefined,
  bands: SizeBand[],
): SizeBand | null {
  // No FTE is not "smallest". A store with an unknown roll would land in the
  // bottom band and drag a small-store median that four other stores rely on.
  if (fte === null || fte === undefined || !Number.isFinite(fte)) return null;

  for (const b of bands) {
    if (b.maxFte === null || fte <= b.maxFte) return b;
  }
  return bands[bands.length - 1] ?? null;
}

/** The configured bands, read through the same policy path billing uses. */
export async function getSizeBands(): Promise<SizeBand[]> {
  const policies = await getEffectivePolicies(["billing.membership_tiers"]);
  const tiers = policies["billing.membership_tiers"] as
    | BillingConfig["membership_tiers"]
    | undefined;
  return sizeBandsFromTiers(tiers ?? []);
}
