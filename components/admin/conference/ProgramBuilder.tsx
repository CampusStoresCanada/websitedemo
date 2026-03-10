"use client";

import { useMemo, useState } from "react";
import {
  deleteConferenceProgramItem,
  type ConferenceProgramItem,
  type ProgramAudienceMode,
  type ProgramItemType,
  upsertConferenceProgramItem,
} from "@/lib/actions/conference-program";

interface ProgramBuilderProps {
  conferenceId: string;
  initialItems: ConferenceProgramItem[];
  allowedItemTypes?: ProgramItemType[];
  conferenceTimeZone?: string | null;
}

const ITEM_TYPES: Array<{ value: ProgramItemType; label: string }> = [
  { value: "meeting", label: "Meetings" },
  { value: "meal", label: "Meals" },
  { value: "education", label: "Educational Session" },
  { value: "trade_show", label: "Trade Show" },
  { value: "offsite", label: "Offsite Event" },
  { value: "move_in", label: "Move-In" },
  { value: "move_out", label: "Move-Out" },
  { value: "custom", label: "Custom" },
];

const ROLE_OPTIONS = [
  { value: "delegate", label: "Members / Delegates" },
  { value: "exhibitor", label: "Partners / Exhibitors" },
  { value: "staff", label: "Conference Staff" },
];

function toDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export default function ProgramBuilder({
  conferenceId,
  initialItems,
  allowedItemTypes,
  conferenceTimeZone,
}: ProgramBuilderProps) {
  const displayTimeZone =
    typeof conferenceTimeZone === "string" && conferenceTimeZone.trim()
      ? conferenceTimeZone
      : undefined;

  const [items, setItems] = useState(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemType, setItemType] = useState<ProgramItemType>("education");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [audienceMode, setAudienceMode] = useState<ProgramAudienceMode>("all_attendees");
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [isRequired, setIsRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const visibleItemTypes = useMemo(() => {
    if (!allowedItemTypes || allowedItemTypes.length === 0) return ITEM_TYPES;
    const allowed = new Set(allowedItemTypes);
    return ITEM_TYPES.filter((type) => allowed.has(type.value));
  }, [allowedItemTypes]);
  const selectedItemType = visibleItemTypes.some((type) => type.value === itemType)
    ? itemType
    : (visibleItemTypes[0]?.value ?? "education");

  const groupedItems = useMemo(() => {
    const map = new Map<ProgramItemType, ConferenceProgramItem[]>();
    for (const type of visibleItemTypes.map((x) => x.value)) map.set(type, []);
    for (const item of items) {
      if (!map.has(item.item_type)) continue;
      map.set(item.item_type, [...(map.get(item.item_type) ?? []), item]);
    }
    return map;
  }, [items, visibleItemTypes]);

  const resetForm = () => {
    setEditingId(null);
    setItemType(visibleItemTypes[0]?.value ?? "education");
    setTitle("");
    setDescription("");
    setStartsAt("");
    setEndsAt("");
    setLocationLabel("");
    setAudienceMode("all_attendees");
    setTargetRoles([]);
    setIsRequired(false);
  };

  const toggleRole = (role: string) => {
    setTargetRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    if (!visibleItemTypes.some((type) => type.value === selectedItemType)) {
      setIsLoading(false);
      setError("Selected item type is not enabled in this conference scope.");
      return;
    }

    const result = await upsertConferenceProgramItem(conferenceId, {
      id: editingId ?? undefined,
      item_type: selectedItemType,
      title,
      description: description || null,
      starts_at: startsAt,
      ends_at: endsAt,
      location_label: locationLabel || null,
      audience_mode: audienceMode,
      target_roles: audienceMode === "target_roles" ? targetRoles : [],
      is_required: isRequired,
    });

    setIsLoading(false);
    if (!result.success || !result.data) {
      setError(result.error ?? "Failed to save program item.");
      return;
    }

    setItems((prev) => {
      const without = prev.filter((item) => item.id !== result.data!.id);
      return [...without, result.data!].sort(
        (a, b) => new Date(a.starts_at).valueOf() - new Date(b.starts_at).valueOf()
      );
    });
    setSuccess(editingId ? "Program item updated." : "Program item added.");
    resetForm();
  };

  const handleEdit = (item: ConferenceProgramItem) => {
    setEditingId(item.id);
    setItemType(item.item_type);
    setTitle(item.title);
    setDescription(item.description ?? "");
    setStartsAt(toDateTimeLocal(item.starts_at));
    setEndsAt(toDateTimeLocal(item.ends_at));
    setLocationLabel(item.location_label ?? "");
    setAudienceMode(item.audience_mode);
    setTargetRoles(item.target_roles ?? []);
    setIsRequired(item.is_required);
    setError(null);
    setSuccess(null);
  };

  const handleDelete = async (itemId: string) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    const result = await deleteConferenceProgramItem(conferenceId, itemId);
    setIsLoading(false);
    if (!result.success) {
      setError(result.error ?? "Failed to delete program item.");
      return;
    }

    setItems((prev) => prev.filter((item) => item.id !== itemId));
    setSuccess("Program item deleted.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Build the full conference program here: meetings, meals, education, trade show, offsite, move-in/out.
        You can target each item to all attendees or specific roles (for example, move-in for exhibitors only).
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {success && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm text-gray-700">
            Item Type
            <select
              value={selectedItemType}
              onChange={(e) => setItemType(e.target.value as ProgramItemType)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            >
              {visibleItemTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Breakfast, Trade Show Open, Move-In, etc."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              required
            />
          </label>
          <label className="block text-sm text-gray-700">
            Start
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              required
            />
          </label>
          <label className="block text-sm text-gray-700">
            End
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              required
            />
          </label>
          <label className="block text-sm text-gray-700 md:col-span-2">
            Location
            <input
              type="text"
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="Main Ballroom, Offsite Venue, Loading Dock, etc."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm text-gray-700 md:col-span-2">
            Description (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-900">Audience</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience_mode"
                value="all_attendees"
                checked={audienceMode === "all_attendees"}
                onChange={() => setAudienceMode("all_attendees")}
              />
              All attendees
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience_mode"
                value="target_roles"
                checked={audienceMode === "target_roles"}
                onChange={() => setAudienceMode("target_roles")}
              />
              Target roles
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience_mode"
                value="manual_curated"
                checked={audienceMode === "manual_curated"}
                onChange={() => setAudienceMode("manual_curated")}
              />
              Manual curated list (coming next)
            </label>
          </div>

          {audienceMode === "target_roles" && (
            <div className="mt-3 flex flex-wrap gap-4">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={targetRoles.includes(role.value)}
                    onChange={() => toggleRole(role.value)}
                  />
                  {role.label}
                </label>
              ))}
            </div>
          )}

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
            />
            Required attendance
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-60"
          >
            {isLoading ? "Saving..." : editingId ? "Update Program Item" : "Add Program Item"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Current Program</h3>
        <div className="mt-4 space-y-4">
          {visibleItemTypes.map((type) => {
            const rows = groupedItems.get(type.value) ?? [];
            if (rows.length === 0) return null;

            return (
              <div key={type.value} className="rounded-md border border-gray-100 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{type.label}</p>
                <div className="mt-2 divide-y divide-gray-100">
                  {rows.map((item) => (
                    <div key={item.id} className="py-3 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                          <p className="text-xs text-gray-600">
                          {new Date(item.starts_at).toLocaleString(undefined, {
                            timeZone: displayTimeZone,
                          })}{" "}
                          -{" "}
                          {new Date(item.ends_at).toLocaleString(undefined, {
                            timeZone: displayTimeZone,
                          })}
                        </p>
                        {item.location_label && (
                          <p className="text-xs text-gray-600">Location: {item.location_label}</p>
                        )}
                        <p className="text-xs text-gray-500">
                          Audience:{" "}
                          {item.audience_mode === "all_attendees"
                            ? "All attendees"
                            : item.audience_mode === "manual_curated"
                              ? "Manual curated list"
                              : (item.target_roles ?? []).join(", ") || "Target roles (none set)"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-sm text-gray-500">No program items yet. Add your first schedule block above.</p>
          )}
        </div>
      </div>
    </div>
  );
}
