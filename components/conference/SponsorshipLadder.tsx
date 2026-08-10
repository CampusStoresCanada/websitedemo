import { getBillingConfig } from "@/lib/policy/engine";
import { getBoothTierAvailability } from "@/lib/actions/conference-availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";

interface Tier {
  name: string;
  price: string;
  availability: string;
  tagline: string;
  color: string;
  highlight?: boolean;
  items: string[];
  note?: string;
}

// Exhibitor/Connected colours match the floor plan's own TYPE_STROKE exactly
// (floor-plan-viewer.tsx) — same navy/red used to mark booth track there.
type ConferenceTierDef = {
  name: string;
  price: string;
  priceCents: number;
  tagline: string;
  color: string;
  highlight?: boolean;
  items: string[];
};

// Featured/Celebrated deliberately have no card here — those are bespoke,
// negotiated deals ("conversations, not ad copy"), pointed at the "get in
// touch" line below instead of being sold off a fixed-menu tier card.
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
      {tier.note && <p className="mt-4 text-xs text-[#6B6B6B]">{tier.note}</p>}
    </div>
  );
}

function RenewedPartnerCard() {
  return (
    <div
      className="flex flex-col justify-center rounded-2xl border-t-4 border-x border-b border-x-[#0F766E]/20 border-b-[#0F766E]/20 bg-[#f0fdfa] p-5 shadow-sm"
      style={{ borderTopColor: "#0F766E" }}
    >
      <h3 className="text-lg font-bold text-[#0F766E]">Thanks for renewing your partnership!</h3>
      <p className="mt-2 text-sm text-[#1A1A1A]/80">
        Your Vendor partnership already covers this conference — no need to renew again here.
      </p>
    </div>
  );
}

export default async function SponsorshipLadder({
  conferenceId,
  partnerAlreadyRenewed = false,
}: {
  conferenceId?: string;
  /** True when the viewer's own Vendor Partner org is already renewed
   *  through this conference's dates — swaps the Vendor tier pitch for a
   *  thank-you instead of re-selling something they've already bought. */
  partnerAlreadyRenewed?: boolean;
}) {
  const billing = await getBillingConfig();
  const vendorRate = billing.partnership_rate;

  const vendorTier: Tier = {
    name: "Vendor",
    price: `$${vendorRate}`,
    availability: "Unlimited",
    tagline: "Every partnership starts here.",
    color: "#0F766E",
    items: ["Member contact list", "Self-managed directory listing", "Circle community access"],
    note: "Please note, purchase of a Vendor tier does not give participation in the 2027 conference.",
  };

  let conferenceTiers: Tier[] = [];
  if (conferenceId) {
    const boothAvailability = await getBoothTierAvailability(conferenceId);
    const byPriceCents = new Map(boothAvailability.map((b) => [b.priceCents, b]));

    conferenceTiers = CONFERENCE_TIERS.flatMap((tier): Tier[] => {
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

  // Featured/Celebrated aren't fixed-menu tiers — they're negotiated
  // conversations, so instead of ad-copy cards this resolves live to
  // whichever super admins can actually have that conversation, rather than
  // a hardcoded name/address that goes stale the moment staff changes.
  const db = createAdminClient();
  const { data: superAdminProfiles } = await db.from("profiles").select("id").eq("global_role", "super_admin");
  const superAdminEmails = superAdminProfiles?.length
    ? Object.values(await lookupUserEmailsByIds(db, superAdminProfiles.map((p) => p.id)))
    : [];
  const contactHref = superAdminEmails.length > 0 ? `mailto:${superAdminEmails.join(",")}` : "mailto:info@campusstores.ca";

  return (
    <section id="find-your-level">
      <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Find your level</h2>
      <p className="mt-1 max-w-2xl text-sm text-[#6B6B6B]">
        Vendor is the year-round partnership required to participate in CSC year round. Not a partner yet? No
        worries, it will be added to your cart!
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {partnerAlreadyRenewed ? <RenewedPartnerCard /> : <TierCard tier={vendorTier} />}
        {conferenceTiers.map((tier) => (
          <TierCard key={tier.name} tier={tier} />
        ))}
      </div>

      <p className="mt-6 text-sm text-[#6B6B6B]">
        Looking for more representation?{" "}
        <a href={contactHref} className="font-medium text-[#EE2A2E] hover:underline">
          Get in contact with us
        </a>
        .
      </p>
    </section>
  );
}
