import type { Contact } from "@/lib/database.types";

interface OrgContactsProps {
  contacts: Contact[];
}

export default function OrgContacts({ contacts }: OrgContactsProps) {
  if (contacts.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-50 rounded-2xl p-6">
      <h3 className="font-semibold text-[#1A1A1A] mb-4">Contacts</h3>

      <div className="space-y-4">
        {contacts.map((contact) => (
          <div key={contact.id} className="flex items-start gap-3">
            {/* Avatar */}
            {contact.profile_picture_url ? (
              <img
                src={contact.profile_picture_url}
                alt={contact.name}
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                <span className="text-slate-500 font-medium text-sm">
                  {getInitials(contact.name)}
                </span>
              </div>
            )}

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[#1A1A1A] truncate">
                {contact.name}
              </p>
              {contact.role_title && (
                <p className="text-sm text-[#6B6B6B] truncate">
                  {contact.role_title}
                </p>
              )}
              {(contact.work_email || contact.email) && (
                <a
                  href={`mailto:${contact.work_email || contact.email}`}
                  className="text-sm text-[#D60001] hover:underline truncate block"
                >
                  {contact.work_email || contact.email}
                </a>
              )}
              {(contact.work_phone_number || contact.phone) && (
                <a
                  href={`tel:${contact.work_phone_number || contact.phone}`}
                  className="text-sm text-[#6B6B6B] hover:text-[#D60001] transition-colors"
                >
                  {contact.work_phone_number || contact.phone}
                </a>
              )}
            </div>
          </div>
        ))}
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
