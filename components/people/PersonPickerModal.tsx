"use client";

import { useState } from "react";
import ContactEditModal from "@/components/org/ContactEditModal";

export type PickablePerson = { id: string; name: string; email: string | null };

/**
 * The "who is this" layer for tying a person to a seat — reused wherever that
 * question comes up (the cart's per-unit assignment slots today; anywhere else
 * that needs "pick an existing person or add a new one" tomorrow). Picking
 * from the list, or adding someone new, both feed back through `onSelect` —
 * "add new" is just this same list flipping to the org's own contact-edit
 * modal (same component used on org/slug) rather than a bespoke form.
 */
export default function PersonPickerModal({
  title = "Who is this for?",
  people,
  organizationId,
  onSelect,
  onDeferLater,
  onClose,
}: {
  title?: string;
  people: PickablePerson[];
  organizationId: string;
  onSelect: (person: { name: string; email: string | null }) => void;
  /** Omit to hide the "assign later" option entirely (e.g. org/slug's roster, where there's always a specific contact already in hand). */
  onDeferLater?: () => void;
  onClose: () => void;
}) {
  const [addingNew, setAddingNew] = useState(false);

  if (addingNew) {
    return (
      <ContactEditModal
        contact={null}
        organizationId={organizationId}
        onClose={() => setAddingNew(false)}
        onCreated={(created) => {
          onSelect({ name: created.name, email: created.email });
        }}
      />
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[190] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-[191] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-white rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-semibold text-[#1A1A1A]">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body — scrollable list */}
          <div className="overflow-y-auto flex-1 px-3 py-3 space-y-1">
            {people.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500">No contacts yet — add the first one below.</p>
            ) : (
              people.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onSelect({ name: person.name, email: person.email })}
                  className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[#1A1A1A] truncate">{person.name}</span>
                    {person.email ? (
                      <span className="block text-xs text-gray-500 truncate">{person.email}</span>
                    ) : null}
                  </span>
                  <svg className="w-4 h-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              ))
            )}

            <button
              onClick={() => setAddingNew(true)}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-emerald-600 font-medium hover:bg-emerald-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add a new person
            </button>

            {onDeferLater ? (
              <button
                onClick={onDeferLater}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                </svg>
                Add Attendee Details Later
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
