import type { SiteContent } from "@/lib/database.types";
import PersonCard from "./PersonCard";

interface StaffSectionProps {
  staff: SiteContent[];
}

export default function StaffSection({ staff }: StaffSectionProps) {
  return (
    <section className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] tracking-tight text-center mb-4">
          Staff
        </h2>
        <p className="text-[#6B6B6B] text-center max-w-2xl mx-auto mb-14">
          The CSC team supports members and partners with day-to-day operations,
          events, and communications.
        </p>
        {staff.length === 0 ? (
          <p className="text-center text-[#6B6B6B]">
            No staff profiles are published yet.
          </p>
        ) : (
          <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10">
            {staff.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
