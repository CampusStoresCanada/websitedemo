import type { SiteContentWithContact } from "@/lib/data";
import VoiceCard from "./VoiceCard";

interface CommunityVoicesProps {
  slots: SiteContentWithContact[];
}

export default function CommunityVoices({ slots }: CommunityVoicesProps) {
  return (
    <section className="py-24 md:py-32 bg-white border-t border-[#E5E5E5]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-2xl mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-[#1A1A1A] tracking-tight mb-4">
            From our community.
          </h2>
          <p className="text-xl text-[#6B6B6B]">
            Members and partners, in their own words.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {slots.map((slot) => (
            <VoiceCard key={slot.id} slot={slot} />
          ))}
        </div>
      </div>
    </section>
  );
}
