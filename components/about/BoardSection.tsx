import type { SiteContent } from "@/lib/database.types";
import PersonCard from "./PersonCard";

interface BoardSectionProps {
  members: SiteContent[];
}

export default function BoardSection({ members }: BoardSectionProps) {
  return (
    <section className="py-20 md:py-28 bg-slate-50">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] tracking-tight text-center mb-4">
          Board of Directors
        </h2>
        <p className="text-[#6B6B6B] text-center max-w-2xl mx-auto mb-14">
          Our volunteer board guides CSC&apos;s strategic direction and
          represents member institutions from across Canada.
        </p>
        {members.length === 0 ? (
          <p className="text-center text-[#6B6B6B]">
            No board members are published yet.
          </p>
        ) : (
          <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10">
            {members.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
