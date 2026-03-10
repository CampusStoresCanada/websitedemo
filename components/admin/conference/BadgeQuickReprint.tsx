"use client";

import { useMemo, useState } from "react";

type PersonOption = {
  id: string;
  displayName: string | null;
  contactEmail: string | null;
  roleTitle: string | null;
  personKind: string;
};

interface BadgeQuickReprintProps {
  conferenceId: string;
  people: PersonOption[];
}

const REASONS = [
  { id: "damaged", label: "Damaged Badge" },
  { id: "lost", label: "Lost Badge" },
  { id: "name_change", label: "Name Change" },
  { id: "ops_override", label: "Ops Override" },
] as const;

export default function BadgeQuickReprint({
  conferenceId,
  people,
}: BadgeQuickReprintProps) {
  const [query, setQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [reason, setReason] = useState<(typeof REASONS)[number]["id"]>("damaged");
  const [note, setNote] = useState("");
  const [transport, setTransport] = useState<"pdf" | "printer_bridge">("pdf");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editBeforePrint, setEditBeforePrint] = useState(false);
  const [editedDisplayName, setEditedDisplayName] = useState("");
  const [editedContactEmail, setEditedContactEmail] = useState("");
  const [editedRoleTitle, setEditedRoleTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people.slice(0, 50);
    return people
      .filter((person) => {
        const display = (person.displayName ?? "").toLowerCase();
        const email = (person.contactEmail ?? "").toLowerCase();
        const kind = (person.personKind ?? "").toLowerCase();
        return display.includes(q) || email.includes(q) || kind.includes(q);
      })
      .slice(0, 50);
  }, [people, query]);

  const selectedPerson = useMemo(
    () => people.find((person) => person.id === selectedPersonId) ?? null,
    [people, selectedPersonId]
  );

  function selectPerson(personId: string) {
    setSelectedPersonId(personId);
    const person = people.find((entry) => entry.id === personId);
    setEditedDisplayName(person?.displayName ?? "");
    setEditedContactEmail(person?.contactEmail ?? "");
    setEditedRoleTitle(person?.roleTitle ?? "");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    setIsError(false);
    if (!selectedPersonId) {
      setIsError(true);
      setMessage("Select a person first.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/people/${selectedPersonId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "reprint_badge",
            reprintReason: reason,
            reprintNote: note.trim().length > 0 ? note.trim() : null,
            transportMethod: transport,
            canonicalPatch: editBeforePrint
              ? {
                  displayName: editedDisplayName.trim().length > 0 ? editedDisplayName.trim() : null,
                  contactEmail:
                    editedContactEmail.trim().length > 0
                      ? editedContactEmail.trim().toLowerCase()
                      : null,
                  roleTitle: editedRoleTitle.trim().length > 0 ? editedRoleTitle.trim() : null,
                }
              : null,
          }),
        }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setIsError(true);
        setMessage(payload.error ?? "Failed to queue reprint.");
        return;
      }

      setMessage("Reprint queued.");
      setNote("");
    } catch {
      setIsError(true);
      setMessage("Reprint request failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Quick Reprint</h2>
      <p className="mt-1 text-sm text-gray-600">
        Search a person, choose reason, queue reprint.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <label className="block text-sm text-gray-700">
          Search person
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type name or email"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <div className="max-h-52 overflow-y-auto rounded-md border border-gray-200">
          {filteredPeople.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matching people.</p>
          ) : (
            <ul>
              {filteredPeople.map((person) => (
                <li key={person.id} className="border-b border-gray-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => selectPerson(person.id)}
                    className={`w-full px-3 py-2 text-left text-sm ${
                      selectedPersonId === person.id
                        ? "bg-[#fff5f5] text-[#D60001]"
                        : "hover:bg-gray-50 text-gray-800"
                    }`}
                  >
                    <div className="font-medium">
                      {person.displayName ?? person.contactEmail ?? person.id}
                    </div>
                    <div className="text-xs text-gray-500">
                      {person.contactEmail ?? "No email"} • {person.personKind}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            Reprint reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as (typeof REASONS)[number]["id"])}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              {REASONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Output
            <select
              value={transport}
              onChange={(e) =>
                setTransport(e.target.value === "printer_bridge" ? "printer_bridge" : "pdf")
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="pdf">PDF (safe fallback)</option>
              <option value="printer_bridge">Printer bridge queue</option>
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={editBeforePrint}
            onChange={(e) => setEditBeforePrint(e.target.checked)}
          />
          Edit canonical person fields before reprint
        </label>

        {editBeforePrint ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm text-gray-700">
              Display name
              <input
                value={editedDisplayName}
                onChange={(e) => setEditedDisplayName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-gray-700">
              Contact email
              <input
                value={editedContactEmail}
                onChange={(e) => setEditedContactEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-gray-700">
              Role title
              <input
                value={editedRoleTitle}
                onChange={(e) => setEditedRoleTitle(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>
          </div>
        ) : null}

        <label className="block text-sm text-gray-700">
          Optional note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            {selectedPerson
              ? `Selected: ${selectedPerson.displayName ?? selectedPerson.contactEmail ?? selectedPerson.id}`
              : "No person selected"}
          </p>
          <button
            type="submit"
            disabled={isSubmitting || !selectedPersonId}
            className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
          >
            {isSubmitting ? "Queuing..." : "Queue Reprint"}
          </button>
        </div>
      </form>

      {message ? (
        <p className={`mt-3 text-sm ${isError ? "text-red-700" : "text-emerald-700"}`}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
