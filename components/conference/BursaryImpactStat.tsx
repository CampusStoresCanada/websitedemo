/**
 * Replaces the fundraising-thermometer framing with a program stat: how many
 * member institutions are funded to attend, scaled from Connected booth
 * sell-through rather than a literal "$500 = one institution" mapping.
 *
 * A literal per-booth mapping caps out at boothsTotal (31 today) and can
 * never reach memberCount (54 today) even at 100% sell-out — the two totals
 * are unrelated capacities. Instead this treats booth sell-through as a
 * ratio and applies it to the live member count, so selling out the last
 * Connected booth always reads as "every member institution funded," and
 * partial sell-through is a proportional, honest in-between — no dollar
 * figure needs to be shown at all. Both totals are live queries (booth
 * inventory, active member count), never hardcoded, since either can change.
 */
export default function BursaryImpactStat({
  boothsSold,
  boothsTotal,
  memberCount,
}: {
  boothsSold: number;
  boothsTotal: number;
  memberCount: number;
}) {
  const pct = boothsTotal > 0 ? Math.min(1, boothsSold / boothsTotal) : 0;
  const institutionsFunded = Math.round(pct * memberCount);

  return (
    <div className="text-center sm:text-left">
      <p className="text-3xl font-bold tracking-tight text-white">
        {institutionsFunded} <span className="text-white/50">of {memberCount}</span>
      </p>
      <p className="mt-1 text-sm text-white/70">member institutions funded so far</p>
      <div className="mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-[#d6001c] transition-[width] duration-700 ease-out"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <p className="mt-3 max-w-xs text-xs text-white/50">
        Selling out our {boothsTotal} Connected booths funds travel for our member institutions.
      </p>
    </div>
  );
}
