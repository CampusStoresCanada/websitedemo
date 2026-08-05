import { getBillingConfig } from "@/lib/policy/engine";
import { getBoothTierAvailability } from "@/lib/actions/conference-availability";

interface Tier {
  name: string;
  price: string;
  availability: string;
  tagline: string;
  color: string;
  highlight?: boolean;
  items: string[];
}

// Exhibitor/Connected colours match the floor plan's own TYPE_STROKE exactly
// (floor-plan-viewer.tsx) — same navy/red used to mark booth track there.
// Featured/Celebrated aren't map-distinguished, so they get their own coordinated
// accents rather than reusing a floor-plan colour that doesn't mean anything
// on the map.
type ConferenceTierDef =
  | {
      name: string;
      price: string;
      priceCents: number;
      tagline: string;
      color: string;
      highlight?: boolean;
      items: string[];
    }
  | {
      name: string;
      price: string;
      availability: string;
      tagline: string;
      color: string;
      items: string[];
    };

const CONFERENCE_TIERS: ConferenceTierDef[] = [
  {
    name: "Exhibitor",
    price: "$4,000",
    priceCents: 400000,
    tagline: "On the floor.",
    color: "#163D6D",
    items: [
      "8′ × 10′ booth — table and folding chairs",
      "Registration for up to 4 staff (meals included during the trade show)",
      "Trade show floor — Wednesday & Thursday",
      "One ticket per day to each offsite event",
    ],
  },
  {
    name: "Connected",
    price: "$6,000",
    priceCents: 600000,
    tagline: "Everything in Exhibitor, plus a full extra day of pre-arranged meetings.",
    color: "#EE2A2E",
    highlight: true,
    items: [
      "Pre-arranged, curated meetings on Tuesday — CSC matches you with the members most relevant to you, using what we already know about them",
      "A full extra day on-site (Tuesday), on top of Wednesday & Thursday on the floor",
      "Hot Products Care Package — your item goes out to every member school, not just the ones attending",
      "Hot Products Online Showcase — present to members ahead of the show (December–January)",
      "$500 of your fee goes directly to a member's travel bursary",
    ],
  },
  {
    name: "Featured",
    price: "$10,000",
    availability: "limited",
    tagline: "Everything in Connected, plus room to do your own thing.",
    color: "#64748B",
    items: [
      "Five minutes to address the full group on-site",
      "One activation of your choosing alongside the conference — a private meeting space, member badges, a place in the post-conference survey, or your own idea, shaped together",
    ],
  },
  {
    name: "Celebrated",
    price: "From $10,000",
    availability: "3 maximum",
    tagline: "Everything in Featured — the whole room stops for you.",
    color: "#B7891A",
    items: [
      "A full-group activation — CSC brings the entire membership to take part: a downtown retail walking tour, an evening event, whatever you propose, built with us",
      "Booth access across all three days, Tuesday–Thursday",
    ],
  },
];

function TierCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={`flex flex-col rounded-2xl border-t-4 border-x border-b p-5 shadow-sm ${
        tier.highlight
          ? "border-x-[#EE2A2E]/20 border-b-[#EE2A2E]/20 bg-[#fff7f7]"
          : "border-x-[#E5E5E5] border-b-[#E5E5E5] bg-white"
      }`}
      style={{ borderTopColor: tier.color }}
    >
      <h3 className="text-lg font-bold" style={{ color: tier.color }}>
        {tier.name}
      </h3>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-[#1A1A1A]">{tier.price}</span>
        <span className="text-xs text-[#6B6B6B]">{tier.availability}</span>
      </div>
      <p className="mt-2 text-xs font-medium text-[#6B6B6B]">{tier.tagline}</p>
      <ul className="mt-4 space-y-2.5">
        {tier.items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-[#1A1A1A]/80">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: tier.color }} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function SponsorshipLadder({ conferenceId }: { conferenceId?: string }) {
  const billing = await getBillingConfig();
  const vendorRate = billing.partnership_rate;

  const vendorTier: Tier = {
    name: "Vendor",
    price: `$${vendorRate}`,
    availability: "Unlimited",
    tagline: "Every partnership starts here.",
    color: "#0F766E",
    items: ["Member contact list", "Self-managed directory listing", "Circle community access"],
  };

  let conferenceTiers: Tier[] = [];
  if (conferenceId) {
    const boothAvailability = await getBoothTierAvailability(conferenceId);
    const byPriceCents = new Map(boothAvailability.map((b) => [b.priceCents, b]));

    conferenceTiers = CONFERENCE_TIERS.flatMap((tier): Tier[] => {
      if (!("priceCents" in tier)) return [tier];
      const avail = byPriceCents.get(tier.priceCents);
      if (!avail || avail.total === 0) return [];
      return [
        {
          ...tier,
          availability: avail.remaining === 0 ? "Sold out" : `${avail.remaining} available`,
        },
      ];
    });
  }

  // Nothing beyond the evergreen Vendor tier to choose between — a "find
  // your level" picker over a single level is just wasted space (that tier's
  // pricing is already shown up in the hero).
  if (conferenceTiers.length === 0) {
    return null;
  }

  return (
    <section id="find-your-level">
      <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Find your level</h2>
      <p className="mt-1 max-w-2xl text-sm text-[#6B6B6B]">
        Vendor is the year-round base every partner gets. When there&apos;s a conference open for registration, the
        tiers below add on top of it.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TierCard tier={vendorTier} />
      </div>

      {conferenceTiers.length > 0 && (
        <>
          <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-[#6B6B6B]">At our next conference</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {conferenceTiers.map((tier) => (
              <TierCard key={tier.name} tier={tier} />
            ))}
          </div>
          <p className="mt-4 text-xs text-[#6B6B6B]">
            Price scales with the ask on Celebrated, and we sort out scope together — only three available, one for
            each night we&apos;re on-site.
          </p>
        </>
      )}
    </section>
  );
}
