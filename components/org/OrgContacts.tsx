import type { VisibleContact } from "@/lib/visibility/data";

interface OrgContactsProps {
  contacts: VisibleContact[];
}

/** Check if a string looks like a masked teaser */
function isMaskedValue(value: string): boolean {
  if (/^([A-Z]\.\s?)+$/.test(value.trim())) return true;
  if (value.startsWith("@")) return true;
  if (value.includes("•")) return true;
  return false;
}

export default function OrgContacts({ contacts }: OrgContactsProps) {
  if (contacts.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-50 rounded-2xl p-6">
      <h3 className="font-semibold text-[#1A1A1A] mb-4">Contacts</h3>

      <div className="space-y-4">
        {contacts.map((contact) => {
          const name = contact.name as string | null;
          const roleTitle = contact.role_title as string | null;
          const email = (contact.work_email || contact.email) as string | null;
          const phone = (contact.work_phone_number || contact.phone) as string | null;

          return (
            <div key={contact.id} className="flex items-start gap-3">
              {/* Avatar */}
              {contact.profile_picture_url ? (
                <img
                  src={contact.profile_picture_url as string}
                  alt={name || "Contact"}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-500 font-medium text-sm">
                    {getInitials(name)}
                  </span>
                </div>
              )}

              {/* Info */}
              <div className="min-w-0 flex-1">
                {name && !isMaskedValue(name) && contact.circle_id ? (
                  <a
                    href={`/api/circle/profile/${contact.id}`}
                    className="font-medium text-[#1A1A1A] hover:text-[#EE2A2E] truncate block"
                  >
                    {name}
                  </a>
                ) : name ? (
                  <p className="font-medium text-[#1A1A1A] truncate">{name}</p>
                ) : null}
                {roleTitle && (
                  <p className="text-sm text-[#6B6B6B] truncate">{roleTitle}</p>
                )}
                {email && (
                  isMaskedValue(email) ? (
                    <p className="text-sm text-[#6B6B6B] truncate">{email}</p>
                  ) : (
                    <a href={`mailto:${email}`} className="text-sm text-[#EE2A2E] hover:underline truncate block">
                      {email}
                    </a>
                  )
                )}
                {phone && (
                  isMaskedValue(phone) ? (
                    <p className="text-sm text-[#6B6B6B]">{phone}</p>
                  ) : (
                    <a href={`tel:${phone}`} className="text-sm text-[#6B6B6B] hover:text-[#EE2A2E] transition-colors">
                      {phone}
                    </a>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
