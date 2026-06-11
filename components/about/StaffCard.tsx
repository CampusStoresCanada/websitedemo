"use client";

import type { Contact } from "@/lib/types/db";
import { fieldProps } from "@/lib/editable-fields";
import { useAuth } from "@/components/providers/AuthProvider";

interface StaffCardProps {
  contact: Contact;
}

export default function StaffCard({ contact }: StaffCardProps) {
  const { user } = useAuth();
  const email = contact.work_email ?? contact.email ?? null;
  const circleHref = contact.circle_id ? `/api/circle/profile/${contact.id}` : null;
  // Use Circle link only when logged in — anonymous visitors get email
  const photoHref = user ? circleHref : (email ? `mailto:${email}` : null);

  const photo = contact.profile_picture_url ? (
    <img
      src={contact.profile_picture_url}
      alt={contact.name || ""}
      className="w-32 h-32 rounded-full object-cover"
    />
  ) : (
    <div className="w-32 h-32 rounded-full bg-slate-200 flex items-center justify-center">
      <span className="text-slate-400 text-3xl font-semibold">
        {getInitials(contact.name)}
      </span>
    </div>
  );

  return (
    <div className="text-center flex flex-col items-center">
      {/* Photo — links to Circle profile if available */}
      <div className="mb-4">
        {photoHref ? (
          <a
            href={photoHref}
            target={user ? "_blank" : undefined}
            rel={user ? "noopener noreferrer" : undefined}
            className="block rounded-full overflow-hidden hover:opacity-90 transition-opacity"
            title={user ? `Open ${contact.name ?? "profile"} in community` : `Email ${contact.name ?? ""}`}
          >
            {photo}
          </a>
        ) : (
          <div className="rounded-full overflow-hidden">{photo}</div>
        )}
      </div>

      {/* Name */}
      <h3
        className="font-semibold text-[#1A1A1A] text-base leading-snug"
        {...fieldProps("contacts", "name", contact.id)}
      >
        {contact.name}
      </h3>

      {/* Role */}
      <p
        className="text-[#6B6B6B] text-sm mt-1"
        {...fieldProps("contacts", "role_title", contact.id)}
      >
        {contact.role_title || "—"}
      </p>

      {/* Email */}
      {email && (
        <a
          href={`mailto:${email}`}
          className="mt-3 text-sm text-[#EE2A2E] hover:underline underline-offset-2 transition-colors"
        >
          {email}
        </a>
      )}
    </div>
  );
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
