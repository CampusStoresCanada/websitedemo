"use client";

import Image from "next/image";
import type { PresentOrg } from "@/lib/actions/conference-meeting-preferences";

/**
 * A tick-list of the organizations at the conference. Used for both
 * "who do you want to meet" and "who would you rather not".
 *
 * Steve's spec, verbatim: checkbox, logo, name linked to the profile in a new
 * tab, then whether they take meetings. "Oh who is that?" — click the name,
 * read, come back to the selection. Nothing else on the row.
 *
 * ⛔ NO ORG TYPE ON THE ROW. Every candidate is a vendor partner, so printing
 * "Vendor Partner" eighty times says nothing and crowds out the one label that
 * does — whether they can actually hold a meeting.
 *
 * ⛔ TARGET="_blank" IS THE POINT. Going to read a profile must not lose a
 * half-finished selection; the list is still there when they come back.
 *
 * Shared rather than written twice: the two lists differ in what a tick MEANS,
 * not in how they look or behave, and two copies would drift the moment one got
 * a fix.
 */
export default function OrgChoiceList({
  orgs,
  selectedIds,
  onToggle,
  disabled = false,
  /** Set when a cap applies — unticked rows lock once it is reached. */
  limit,
  accentClassName = "accent-[#163D6D]",
}: {
  orgs: PresentOrg[];
  selectedIds: string[];
  onToggle: (orgId: string) => void;
  disabled?: boolean;
  limit?: number;
  accentClassName?: string;
}) {
  const atLimit = typeof limit === "number" && selectedIds.length >= limit;

  return (
    <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
      {orgs.map((org) => {
        const isSelected = selectedIds.includes(org.id);
        // Only unticked rows lock at the cap, so the tick that frees a slot
        // always stays clickable.
        const isLocked = disabled || (atLimit && !isSelected);

        return (
          <li key={org.id}>
            <label
              className={`flex items-center gap-3 px-3 py-2 ${
                isLocked ? "opacity-50" : "cursor-pointer hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isLocked}
                onChange={() => onToggle(org.id)}
                className={`h-4 w-4 shrink-0 rounded border-gray-300 ${accentClassName}`}
              />

              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100">
                {org.logoUrl ? (
                  <Image
                    src={org.logoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 object-contain"
                    unoptimized
                  />
                ) : (
                  <span className="text-[10px] font-semibold text-gray-500">
                    {org.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                {org.slug ? (
                  <a
                    href={`/org/${org.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    // Stop the label from toggling the box when they meant to read.
                    onClick={(event) => event.stopPropagation()}
                    className="font-medium text-[#163D6D] hover:underline"
                  >
                    {org.name}
                  </a>
                ) : (
                  <span className="font-medium">{org.name}</span>
                )}
                <span className="text-gray-500">
                  {" — "}
                  {org.takesMeetings ? "Connected Exhibitor" : "No meetings"}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
