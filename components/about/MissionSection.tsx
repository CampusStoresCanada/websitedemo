import type { SiteContent } from "@/lib/types/db";
import { fieldProps } from "@/lib/editable-fields";

interface MissionSectionProps {
  mission: SiteContent | null;
  whatWeDo: SiteContent[];
}

const FALLBACK_MISSION =
  "Campus Stores Canada (CSC) advocates for and supports campus retail operations at post-secondary institutions across the country. We provide a forum for collaboration, professional development, and benchmarking — ensuring campus stores can deliver exceptional service to students, faculty, and staff.";

const FALLBACK_BULLETS = [
  "Benchmarking surveys and data sharing to help stores make data-driven decisions",
  "Annual conferences, regional meetups, and peer-learning opportunities",
  "Vendor partner program connecting stores with trusted suppliers",
  "Advocacy for institutional independence and campus retail sustainability",
];

export default function MissionSection({ mission, whatWeDo }: MissionSectionProps) {
  const missionText = mission?.body ?? FALLBACK_MISSION;
  const bullets = whatWeDo.length > 0 ? whatWeDo : null;

  return (
    <section className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          {/* Mission */}
          <div>
            <h2 className="text-sm uppercase tracking-wider text-[#EE2A2E] font-semibold mb-4">
              Why CSC
            </h2>
            <p
              className="text-lg text-[#4A4A4A] leading-relaxed"
              {...(mission ? fieldProps("site_content", "body", mission.id) : {})}
            >
              {missionText}
            </p>
          </div>

          {/* What We Do */}
          <div>
            <h2 className="text-sm uppercase tracking-wider text-[#EE2A2E] font-semibold mb-4">
              What We Do
            </h2>
            <ul className="space-y-4 text-lg text-[#4A4A4A]">
              {bullets
                ? bullets.map((item) => (
                    <li key={item.id} className="flex items-start gap-3">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-[#EE2A2E] flex-shrink-0" />
                      <span {...fieldProps("site_content", "body", item.id)}>
                        {item.body}
                      </span>
                    </li>
                  ))
                : FALLBACK_BULLETS.map((text, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-[#EE2A2E] flex-shrink-0" />
                      <span>{text}</span>
                    </li>
                  ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
