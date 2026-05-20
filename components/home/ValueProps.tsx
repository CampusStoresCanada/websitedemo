import {
  UsersRound,
  Shield,
  BarChart3,
  Lightbulb,
  Users,
  Megaphone,
  Database,
  Zap,
  TrendingUp,
  BookOpen,
  Globe,
  Star,
  Network,
  Handshake,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import type { SiteContentWithContact } from "@/lib/data";
import { fieldProps } from "@/lib/editable-fields";

// ─── Icon registry ────────────────────────────────────────────────────────────
// Add any Lucide icon here and reference it by key in site_content.metadata.icon
const ICON_MAP: Record<string, LucideIcon> = {
  users_round:   UsersRound,
  shield:        Shield,
  bar_chart:     BarChart3,
  lightbulb:     Lightbulb,
  users:         Users,
  megaphone:     Megaphone,
  database:      Database,
  zap:           Zap,
  trending_up:   TrendingUp,
  book_open:     BookOpen,
  globe:         Globe,
  star:          Star,
  network:       Network,
  handshake:     Handshake,
  flask:         FlaskConical,
};

const DEFAULT_ICON: LucideIcon = Users;

// ─── Fallback content (used when DB rows haven't been seeded) ─────────────────

interface ValuePropsProps {
  header: SiteContentWithContact | null;
  cards: SiteContentWithContact[];
}

const FALLBACK_HEADER = {
  title: "More than a network.",
  subtitle: "A community.",
  body: "CSC transforms campus retail from a traditional business operation into a vital educational partner that enhances student success.",
};

const FALLBACK_CARDS = [
  {
    title: "Member Space",
    body: "Take yourself out of your campus store and into a community of 250+ peers, mentors, and fellow professionals — all motivated to share because no one has the budget to figure it all out alone. Immediate, searchable, and genuinely useful.",
    bullets: ["Circle community platform, 250+ members", "Searchable discussions and peer resources", "Direct messaging with fellow professionals"],
    icon: "users_round",
  },
  {
    title: "Independence, Supported",
    body: "From Access Copyright to vendor negotiations to POS feature requests, CSC ensures campus retail has a seat at the table. And when an institution is looking to bring their operation back in-house, we get there first — with connections, resources, and people who've done it before.",
    bullets: ["Access Copyright & licensing advocacy", "Follett repatriation support", "Vendor and POS platform negotiations"],
    icon: "shield",
  },
  {
    title: "Data You Can't Buy",
    body: "Benchmarking, internal financials, org charts, job titles, and vetted partners — all from real Canadian institutions. The intelligence you need to make the case internally and run a better operation.",
    bullets: ["Annual benchmarking reports", "Salary, org chart, and operational data", "Vetted Canadian vendor directory"],
    icon: "bar_chart",
  },
  {
    title: "Know It Before You Need It",
    body: "Retail consultant trend briefings, peer-reported pilots, and a twice-annual hot products showcase where members bring whatever is actually working on their floor.",
    bullets: ["Twice-annual hot products showcase", "Retail consultant trend briefings", "Peer-reported product pilots"],
    icon: "lightbulb",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ValueProps({ header, cards }: ValuePropsProps) {
  const titleText   = header?.title    ?? FALLBACK_HEADER.title;
  const subtitleText = header?.subtitle ?? FALLBACK_HEADER.subtitle;
  const descText    = header?.body     ?? FALLBACK_HEADER.body;

  const displayCards = cards.length > 0 ? cards : null;

  return (
    <section className="py-24 md:py-32 bg-[#FAFAFA]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Section Header */}
        <div className="max-w-3xl mb-20">
          <h2 className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-6">
            <span {...(header ? fieldProps("site_content", "title", header.id) : {})}>
              {titleText}
            </span>
            <br />
            <span
              className="text-[#6B6B6B]"
              {...(header ? fieldProps("site_content", "subtitle", header.id) : {})}
            >
              {subtitleText}
            </span>
          </h2>
          <p
            className="text-xl text-[#6B6B6B] leading-relaxed"
            {...(header ? fieldProps("site_content", "body", header.id) : {})}
          >
            {descText}
          </p>
        </div>

        {/* Value Props Grid */}
        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          {displayCards
            ? displayCards.map((card, idx) => {
                const iconKey = (getMetaField(card.metadata, "icon") as string | undefined)
                  ?? FALLBACK_CARDS[idx]?.icon
                  ?? "users_round";
                const bullets =
                  (getMetaField(card.metadata, "bullets") as string[] | undefined)
                  ?? FALLBACK_CARDS[idx]?.bullets
                  ?? [];

                return (
                  <ValueCard
                    key={card.id}
                    iconKey={iconKey}
                    title={card.title ?? FALLBACK_CARDS[idx]?.title ?? ""}
                    body={card.body ?? FALLBACK_CARDS[idx]?.body ?? ""}
                    bullets={bullets}
                    titleProps={fieldProps("site_content", "title", card.id)}
                    bodyProps={fieldProps("site_content", "body", card.id)}
                  />
                );
              })
            : FALLBACK_CARDS.map((card, idx) => (
                <ValueCard
                  key={idx}
                  iconKey={card.icon}
                  title={card.title}
                  body={card.body}
                  bullets={card.bullets}
                />
              ))}
        </div>
      </div>
    </section>
  );
}

// ─── Card sub-component ───────────────────────────────────────────────────────

interface ValueCardProps {
  iconKey: string;
  title: string;
  body: string;
  bullets: string[];
  titleProps?: object;
  bodyProps?: object;
}

function ValueCard({ iconKey, title, body, bullets, titleProps = {}, bodyProps = {} }: ValueCardProps) {
  const Icon = ICON_MAP[iconKey] ?? DEFAULT_ICON;

  return (
    <div className="group relative bg-white rounded-3xl p-8 md:p-10 border border-[#E5E5E5] hover:border-[#EE2A2E]/20 hover:shadow-xl transition-all duration-300">
      <div className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-[#EE2A2E]/10 flex items-center justify-center group-hover:bg-[#EE2A2E] transition-colors">
        <Icon className="w-6 h-6 text-[#EE2A2E] group-hover:text-white transition-colors" strokeWidth={1.5} />
      </div>
      <div className="pr-16">
        <h3
          className="text-2xl font-semibold text-[#1A1A1A] mb-4"
          {...titleProps}
        >
          {title}
        </h3>
        <p
          className="text-[#6B6B6B] leading-relaxed mb-6"
          {...bodyProps}
        >
          {body}
        </p>
        <ul className="space-y-2">
          {bullets.map((bullet, i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-[#6B6B6B]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#EE2A2E]" />
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMetaField(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== "object") return undefined;
  return (metadata as Record<string, unknown>)[key];
}
