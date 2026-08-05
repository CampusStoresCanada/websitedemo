/**
 * Replaces the fundraising-thermometer framing with a program stat: how many
 * member institutions are funded to attend so far, out of the live active
 * member count (not a hardcoded number — that count moves as membership
 * does, so the denominator is passed in from a real query each render).
 */
export default function BursaryImpactStat({
  delegatesFunded,
  memberCount,
}: {
  delegatesFunded: number;
  memberCount: number;
}) {
  const pct = memberCount > 0 ? Math.min(1, delegatesFunded / memberCount) : 0;

  return (
    <div className="text-center sm:text-left">
      <p className="text-3xl font-bold tracking-tight text-white">
        {delegatesFunded} <span className="text-white/50">of {memberCount}</span>
      </p>
      <p className="mt-1 text-sm text-white/70">member institutions funded so far</p>
      <div className="mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-[#d6001c] transition-[width] duration-700 ease-out"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <p className="mt-3 max-w-xs text-xs text-white/50">
        $500 from every Connected+ booth funds one member institution&apos;s trip to the conference.
      </p>
    </div>
  );
}
