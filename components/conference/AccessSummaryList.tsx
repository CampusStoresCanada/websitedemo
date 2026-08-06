import type { AccessSummary } from "@/lib/conference/entity-commerce";

const TRADE_SHOW_WEDNESDAY_ID = "5eb4edca-a7ec-4924-997f-e369baf408e0";
// Canonical name throughout the conference is "Big Ideas Day" — not "Big
// Shiny Ideas" or "Course Materials Unconference" (its former name).
const BIG_IDEAS_DAY_ID = "5752d511-1a55-4c14-9b38-9b8e8b565c2b";

/**
 * Persuasive "what you get" summary for a registration card — grouped and
 * counted (all meals, every evening event) rather than the item-by-item
 * catalog dump `Grant[]`/`includes` produces. See summarizeAccess().
 */
export default function AccessSummaryList({ access }: { access: AccessSummary }) {
  const lines: string[] = [];

  if (access.days.length === 1) {
    lines.push(`${access.days[0]} on-site`);
  } else if (access.days.length > 1) {
    lines.push(`${access.days.length} days on-site — ${access.days[0]} to ${access.days[access.days.length - 1]}`);
  }
  if (access.meetingDay) lines.push(`${access.meetingDay} — curated partner meetings, matched to you`);

  for (const day of access.tradeShowDays) {
    if (day.id === BIG_IDEAS_DAY_ID) continue;
    if (day.id === TRADE_SHOW_WEDNESDAY_ID) {
      lines.push(`${day.name} — the full floor, all ${access.exhibitorCount} exhibitors`);
    } else {
      lines.push(day.name);
    }
  }
  // Now a real, Member-only catalog entity (session) — reachable via
  // Full Conference Registration and Thursday Day Pass's `involved_in` refs,
  // with its own when/start/end spanning the full day past the floor's close.
  if (access.tradeShowDays.some((d) => d.id === BIG_IDEAS_DAY_ID)) {
    lines.push("Big Ideas Day — all day, including after the floor closes (optional, included)");
  }

  if (access.mealsIncluded) lines.push("All meals included");
  if (access.events.length === 1) {
    lines.push(access.events[0]);
  } else if (access.events.length > 1) {
    lines.push(access.events.join(" · "));
  }

  if (lines.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">What&apos;s included</div>
      <ul className="mt-1 space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-1.5 text-sm text-gray-700">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-600" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
