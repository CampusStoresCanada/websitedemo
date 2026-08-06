import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

// Colours echo the site's existing vocabulary (red = the marquee day, navy =
// the broad trade-show day, slate = the wind-down day) without claiming the
// tier meaning those colours carry elsewhere (SponsorshipLadder, the schedule
// blocks) — this is day-of-week framing for delegates, not a tier system.
const DAYS = [
  {
    name: "Tuesday",
    color: "#EE2A2E",
    tagline: "Curated meetings, matched to you.",
    detail: "A day of pre-arranged meetings — CSC matches you with the partners most relevant to your institution, using what we already know about you. Built primarily around general merchandise (accessories, apparel, campus living, gifts & promotion, graduation & regalia, school & lab supplies, technology), closing with an evening trade show session.",
  },
  {
    name: "Wednesday",
    color: "#163D6D",
    tagline: "A full day on the trade show floor.",
    detail: "The full floor, every exhibitor — browse, connect, and write orders across the whole show, breakfast through dinner. The day wraps with the Wednesday Offsite, included with your registration.",
  },
  {
    name: "Thursday",
    color: "#64748B",
    tagline: "The floor, plus Big Ideas Day.",
    detail: "A half day on the trade show floor with every exhibitor, alongside Big Ideas Day — starting with the 8:30 AM Keynote, a combined track for Course Materials, Operations, and their related vendors to present, discuss, and come together around the big ideas shaping our industry now and in the future.",
  },
];

const BULLETS = [
  "More networking sessions and offsite opportunities than ever.",
  "Continuous 5-minute shuttles to and from Toronto Pearson Airport.",
  "Trade-show-only pricing and specials that can help offset the cost of attending.",
  "Registering qualifies your institution for a share of the delegate travel bursary.*",
];

/** The pitch for why a member institution should send a delegate — the counterpart to SponsorshipLadder on the partner side. */
export default async function MemberValueProps({
  conferenceId,
  conferenceYear,
  conferenceEdition,
}: {
  conferenceId: string;
  /** Optional — when set, shows a link to the printable business-case page for that edition. */
  conferenceYear?: string;
  conferenceEdition?: string;
}) {
  const { count } = await createAdminClient()
    .from("conference_entities")
    .select("id", { count: "exact", head: true })
    .eq("conference_id", conferenceId)
    .eq("kind", "booth")
    .eq("is_for_sale", true);

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Why be in the room</h2>
      <p className="mt-1 max-w-2xl text-sm text-[#6B6B6B]">
        Meet with up to {count ?? 60} industry partners and network with members from institutions across Canada — all
        in one trip.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {DAYS.map((day) => (
          <div
            key={day.name}
            className="flex flex-col rounded-2xl border-x border-b border-t-4 border-x-[#E5E5E5] border-b-[#E5E5E5] bg-white p-5 shadow-sm"
            style={{ borderTopColor: day.color }}
          >
            <h3 className="text-lg font-bold" style={{ color: day.color }}>
              {day.name}
            </h3>
            <p className="mt-2 text-sm font-medium text-[#1A1A1A]">{day.tagline}</p>
            <p className="mt-2 text-sm text-[#1A1A1A]/80">{day.detail}</p>
          </div>
        ))}
      </div>

      <ul className="mt-6 space-y-2.5">
        {BULLETS.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-[#1A1A1A]/80">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#EE2A2E]" />
            {item}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-[#6B6B6B]">
        *If we hit our bursary goal, every institution that applies is paid in full. If we don&apos;t, the pool is
        split equally among everyone who applies.
      </p>

      {conferenceYear && conferenceEdition && (
        <p className="mt-4 text-sm">
          <Link
            href={`/conference/${conferenceYear}/${conferenceEdition}/business-case`}
            className="font-medium text-[#EE2A2E] hover:underline"
          >
            Need to make the case to your director? Get the printable business case →
          </Link>
        </p>
      )}
    </section>
  );
}
