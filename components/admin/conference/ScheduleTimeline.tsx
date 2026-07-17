"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConferenceScheduleItem } from "@/lib/conference/schedule-service";
import type { BuildEntity } from "@/lib/actions/conference-entities";
import { colorForKind } from "@/lib/conference/schedule-colors";
import {
  deleteScheduleItem,
  saveScheduleItem,
  type ScheduleItemInput,
} from "@/lib/actions/conference-schedule-edit";

/**
 * The linear daily schedule — one ordered list of everything in the catalog
 * that lands on a day, grouped by day, nested where things relate (a meal
 * during a block shows under it), and coloured by kind. Editable in place:
 * add / rename / retime / move day / relocate / set audience / delete, all
 * writing the same catalog entities Build edits. Deeper composition
 * (what-includes-what) stays in Build, linked per row.
 */

type Props = {
  conferenceId: string;
  items: ConferenceScheduleItem[];
  entities: BuildEntity[];
  timeZone: string;
};

type Pick = { id: string; name: string };
type FormState = { mode: "add" } | { mode: "edit"; id: string } | null;

const KIND_OPTIONS = ["session", "meeting", "event", "networking", "meal"];
const inputClass =
  "rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent";

function dayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function timeRange(item: ConferenceScheduleItem): string {
  if (!item.startsAtLocal) return "All day";
  return item.endsAtLocal ? `${item.startsAtLocal} – ${item.endsAtLocal}` : item.startsAtLocal;
}

export default function ScheduleTimeline({ conferenceId, items, entities, timeZone }: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState>(null);

  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const days = useMemo<Pick[]>(
    () =>
      entities
        .filter((e) => e.kind === "day")
        .sort((a, b) =>
          String(a.attributes.date ?? "").localeCompare(String(b.attributes.date ?? ""))
        )
        .map((e) => ({ id: e.id, name: e.name })),
    [entities]
  );
  const venues = useMemo<Pick[]>(
    () => entities.filter((e) => e.kind === "venue").map((e) => ({ id: e.id, name: e.name })),
    [entities]
  );
  const audiences = useMemo<Pick[]>(
    () => entities.filter((e) => e.kind === "audience").map((e) => ({ id: e.id, name: e.name })),
    [entities]
  );

  // Group by day, then build a parent→children tree per day.
  const dayGroups = useMemo(() => {
    const program = items.filter((i) => i.source === "program");
    const byId = new Map(program.map((i) => [i.id, i]));
    const byDay = new Map<string, ConferenceScheduleItem[]>();
    for (const item of program) {
      const list = byDay.get(item.dayKeyLocal) ?? [];
      list.push(item);
      byDay.set(item.dayKeyLocal, list);
    }
    const sortByStart = (a: ConferenceScheduleItem, b: ConferenceScheduleItem) =>
      a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);

    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, dayItems]) => {
        const childrenByParent = new Map<string, ConferenceScheduleItem[]>();
        const roots: ConferenceScheduleItem[] = [];
        for (const item of dayItems) {
          const parent = item.parentId ? byId.get(item.parentId) : null;
          if (parent && parent.dayKeyLocal === dayKey) {
            const list = childrenByParent.get(parent.id) ?? [];
            list.push(item);
            childrenByParent.set(parent.id, list);
          } else roots.push(item);
        }
        roots.sort(sortByStart);
        for (const list of childrenByParent.values()) list.sort(sortByStart);
        return {
          dayKey,
          count: dayItems.length,
          nodes: roots.map((item) => ({ item, children: childrenByParent.get(item.id) ?? [] })),
        };
      });
  }, [items]);

  const totalItems = dayGroups.reduce((n, d) => n + d.count, 0);

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Remove "${title}" from the schedule? This deletes the catalog item.`)) return;
    const res = await deleteScheduleItem(id);
    if (res.success) {
      setForm(null);
      router.refresh();
    } else {
      window.alert(res.error);
    }
  }

  const renderRowOrForm = (item: ConferenceScheduleItem, nested: boolean, parentTitle?: string) =>
    form?.mode === "edit" && form.id === item.id ? (
      <ScheduleItemForm
        conferenceId={conferenceId}
        entity={entityById.get(item.id) ?? null}
        days={days}
        venues={venues}
        audiences={audiences}
        onClose={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          router.refresh();
        }}
      />
    ) : (
      <ScheduleRow
        item={item}
        nested={nested}
        parentTitle={parentTitle}
        onEdit={() => setForm({ mode: "edit", id: item.id })}
        onDelete={() => void handleDelete(item.id, item.title)}
      />
    );

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Daily schedule</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {totalItems} item{totalItems === 1 ? "" : "s"} across {dayGroups.length} day
            {dayGroups.length === 1 ? "" : "s"} · times in {timeZone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setForm({ mode: "add" })}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            + Add to schedule
          </button>
          <Link
            href={`/admin/conference/${conferenceId}/build`}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit in Build
          </Link>
        </div>
      </div>

      <Legend />

      {form?.mode === "add" && (
        <div className="border-b border-gray-100 px-3 py-3">
          <ScheduleItemForm
            conferenceId={conferenceId}
            entity={null}
            days={days}
            venues={venues}
            audiences={audiences}
            onClose={() => setForm(null)}
            onSaved={() => {
              setForm(null);
              router.refresh();
            }}
          />
        </div>
      )}

      {totalItems === 0 && form?.mode !== "add" ? (
        <div className="px-4 py-6 text-sm text-gray-600">
          Nothing is scheduled yet. Use <strong>Add to schedule</strong>, or add things in{" "}
          <Link href={`/admin/conference/${conferenceId}/build`} className="font-medium text-accent hover:underline">
            Build
          </Link>
          .
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {dayGroups.map((day) => {
            const isCollapsed = collapsed.has(day.dayKey);
            return (
              <section key={day.dayKey}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(day.dayKey)) next.delete(day.dayKey);
                      else next.add(day.dayKey);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 bg-gray-50 px-4 py-2 text-left"
                >
                  <span className="text-gray-400">{isCollapsed ? "▸" : "▾"}</span>
                  <span className="text-sm font-semibold text-gray-900">{dayLabel(day.dayKey)}</span>
                  <span className="text-xs text-gray-400">
                    {day.count} item{day.count === 1 ? "" : "s"}
                  </span>
                </button>

                {!isCollapsed && (
                  <ol className="px-3 py-2">
                    {day.nodes.map((node) => (
                      <li key={node.item.id}>
                        {renderRowOrForm(node.item, false)}
                        {node.children.length > 0 && (
                          <ol className="ml-6 border-l border-dashed border-gray-200 pl-3">
                            {node.children.map((child) => (
                              <li key={child.id}>{renderRowOrForm(child, true, node.item.title)}</li>
                            ))}
                          </ol>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  item,
  nested = false,
  parentTitle,
  onEdit,
  onDelete,
}: {
  item: ConferenceScheduleItem;
  nested?: boolean;
  parentTitle?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = colorForKind(item.kind);
  return (
    <div
      className="group my-1 flex items-start gap-3 rounded-md border px-3 py-2"
      style={{ backgroundColor: color.bg, borderColor: color.border, borderLeft: `3px solid ${color.accent}` }}
    >
      <div className="w-32 shrink-0 text-xs font-medium tabular-nums" style={{ color: color.text }}>
        {timeRange(item)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{item.title}</span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium capitalize"
            style={{ backgroundColor: color.accent, color: "#fff" }}
          >
            {item.kind.replace(/_/g, " ")}
          </span>
          {nested && parentTitle && (
            <span className="text-[10px] text-gray-400">during {parentTitle}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
          {item.locationLabel && <span>📍 {item.locationLabel}</span>}
          {item.audienceNames.length > 0 && <span>👥 {item.audienceNames.join(", ")}</span>}
          {item.description && <span className="text-gray-500">{item.description}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          className="rounded border border-gray-300 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-white"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-gray-300 bg-white/70 px-2 py-0.5 text-[11px] text-red-600 hover:bg-white"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ScheduleItemForm({
  conferenceId,
  entity,
  days,
  venues,
  audiences,
  onClose,
  onSaved,
}: {
  conferenceId: string;
  entity: BuildEntity | null;
  days: Pick[];
  venues: Pick[];
  audiences: Pick[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const currentWhenId = entity?.refs.find((r) => r.role === "when")?.toEntityId ?? "";
  const currentWhereId = entity?.refs.find((r) => r.role === "where")?.toEntityId ?? "";
  const currentWhoIds = entity?.refs.filter((r) => r.role === "who").map((r) => r.toEntityId) ?? [];
  const attrs = entity?.attributes ?? {};

  const [kind, setKind] = useState(entity?.kind ?? "session");
  const [name, setName] = useState(entity?.name ?? "");
  const [whenId, setWhenId] = useState(currentWhenId || days[0]?.id || "");
  const [startTime, setStartTime] = useState(
    typeof attrs.start_time === "string" ? attrs.start_time : ""
  );
  const [endTime, setEndTime] = useState(typeof attrs.end_time === "string" ? attrs.end_time : "");
  const [whereSel, setWhereSel] = useState(currentWhereId || "");
  const [newVenue, setNewVenue] = useState("");
  const [whoIds, setWhoIds] = useState<string[]>(currentWhoIds);
  const [description, setDescription] = useState(
    typeof attrs.purpose === "string"
      ? attrs.purpose
      : typeof attrs.notes === "string"
        ? attrs.notes
        : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preserve a `when` that points at a non-day block so editing doesn't drop it.
  const whenOptions: Pick[] =
    currentWhenId && !days.some((d) => d.id === currentWhenId)
      ? [...days, { id: currentWhenId, name: `${entity?.refs.find((r) => r.role === "when")?.toName ?? "current"} (block)` }]
      : days;

  const kindOptions = KIND_OPTIONS.includes(kind) ? KIND_OPTIONS : [kind, ...KIND_OPTIONS];

  async function save() {
    if (!name.trim()) {
      setError("Give the item a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const input: ScheduleItemInput = {
      id: entity?.id,
      kind: kind.trim(),
      name: name.trim(),
      whenId: whenId || null,
      startTime: startTime || null,
      endTime: endTime || null,
      description: description.trim() || null,
      whereId: whereSel === "__new__" ? null : whereSel || null,
      newVenueName: whereSel === "__new__" ? newVenue.trim() || null : null,
      whoIds,
    };
    const res = await saveScheduleItem(conferenceId, input);
    setSaving(false);
    if (res.success) onSaved();
    else setError(res.error);
  }

  return (
    <div className="my-1 rounded-md border border-accent/40 bg-blue-50/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Welcome Reception" />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputClass} bg-white`}>
            {kindOptions.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
          Day
          <select value={whenId} onChange={(e) => setWhenId(e.target.value)} className={`${inputClass} bg-white`}>
            <option value="">— pick a day —</option>
            {whenOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-gray-500">
            Starts
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-gray-500">
            Ends
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
          Location
          <select value={whereSel} onChange={(e) => setWhereSel(e.target.value)} className={`${inputClass} bg-white`}>
            <option value="">Unassigned</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            <option value="__new__">+ New venue…</option>
          </select>
        </label>
        {whereSel === "__new__" && (
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            New venue name
            <input value={newVenue} onChange={(e) => setNewVenue(e.target.value)} className={inputClass} placeholder="e.g. Grand Ballroom" />
          </label>
        )}
      </div>

      {audiences.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] text-gray-500">Audience</span>
          <div className="mt-0.5 flex flex-wrap gap-2">
            {audiences.map((a) => {
              const checked = whoIds.includes(a.id);
              return (
                <label key={a.id} className="inline-flex items-center gap-1 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setWhoIds((prev) =>
                        e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                      )
                    }
                  />
                  {a.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <label className="mt-2 flex flex-col gap-0.5 text-[11px] text-gray-500">
        Notes
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Optional details"
        />
      </label>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : entity ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-gray-400">
          Deeper structure (what this includes) lives in Build.
        </span>
      </div>
    </div>
  );
}

function Legend() {
  const kinds: Array<[string, string]> = [
    ["session", "Session"],
    ["meeting", "Meeting"],
    ["event", "Event"],
    ["networking", "Networking"],
    ["meal", "Meal"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2">
      {kinds.map(([kind, label]) => {
        const c = colorForKind(kind);
        return (
          <span key={kind} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.accent }} />
            {label}
          </span>
        );
      })}
    </div>
  );
}
