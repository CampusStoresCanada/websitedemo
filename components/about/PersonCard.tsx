import type { SiteContent } from "@/lib/database.types";

interface PersonCardProps {
  person: SiteContent;
}

export default function PersonCard({ person }: PersonCardProps) {
  return (
    <div className="text-center">
      {/* Photo */}
      {person.image_url ? (
        <img
          src={person.image_url}
          alt={person.title || ""}
          className="w-32 h-32 rounded-full object-cover mx-auto mb-4"
        />
      ) : (
        <div className="w-32 h-32 rounded-full bg-slate-200 flex items-center justify-center mx-auto mb-4">
          <span className="text-slate-400 text-3xl font-semibold">
            {getInitials(person.title)}
          </span>
        </div>
      )}

      {/* Name */}
      <h3 className="font-semibold text-[#1A1A1A] text-lg">{person.title}</h3>

      {/* Role */}
      {person.subtitle && (
        <p className="text-[#6B6B6B] text-sm mt-1">{person.subtitle}</p>
      )}

      {/* Bio */}
      {person.body && (
        <p className="text-[#6B6B6B] text-sm mt-3 max-w-xs mx-auto leading-relaxed">
          {person.body}
        </p>
      )}
    </div>
  );
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
