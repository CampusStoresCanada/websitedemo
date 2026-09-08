"use client";

import { useState } from "react";
import {
  BADGE_SORT_KEYS,
  BADGE_SORT_LABELS,
  type BadgeArrangement,
  type BadgeArrangementSection,
  type BadgeSortKey,
} from "@/lib/conference/badges/arrangement";

/**
 * How the print file is stacked.
 *
 * A preflight question, not a design one — the editor answers "does this badge
 * look right", this answers "what order do they come off the printer in".
 *
 * ⛔ Two things an earlier version got wrong, both worth not repeating:
 *   1. It printed each registration type's name three times per section — as
 *      the label, as a list row, and again inside every dropdown. A section
 *      holding one type IS that type; say its name once.
 *   2. Joining piles together was the whole point and it was invisible, hidden
 *      in a per-row <select> with only an aria-label. A control nobody can see
 *      is a feature nobody has.
 */

type TypeInfo = { entityId: string; name: string; count: number };

export default function BadgeArrangementEditor({
  types,
  initial,
  saveAction,
}: {
  types: TypeInfo[];
  initial: BadgeArrangement;
  saveAction: (arrangement: BadgeArrangement) => Promise<void>;
}) {
  const [sections, setSections] = useState<BadgeArrangementSection[]>(initial.sections);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const typeOf = (id: string) => types.find((t) => t.entityId === id);
  const countOf = (s: BadgeArrangementSection) =>
    s.entityIds.reduce((n, id) => n + (typeOf(id)?.count ?? 0), 0);
  const touched = () => setSaved(false);

  const update = (id: string, patch: Partial<BadgeArrangementSection>) => {
    touched();
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const move = (i: number, delta: number) => {
    touched();
    setSections((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  /** Fold one whole section into another — "these two piles become one". */
  const mergeInto = (fromId: string, intoId: string) => {
    touched();
    setSections((prev) => {
      const from = prev.find((s) => s.id === fromId);
      if (!from || fromId === intoId) return prev;
      return prev
        .map((s) =>
          s.id === intoId ? { ...s, entityIds: [...s.entityIds, ...from.entityIds] } : s
        )
        .filter((s) => s.id !== fromId);
    });
  };

  /** Pull one type back out into a pile of its own. */
  const separate = (sectionId: string, entityId: string) => {
    touched();
    setSections((prev) => {
      const out: BadgeArrangementSection[] = [];
      for (const s of prev) {
        if (s.id !== sectionId) {
          out.push(s);
          continue;
        }
        const remaining = s.entityIds.filter((id) => id !== entityId);
        if (remaining.length > 0) out.push({ ...s, entityIds: remaining });
        out.push({
          id: entityId,
          label: typeOf(entityId)?.name ?? entityId,
          entityIds: [entityId],
          sortBy: s.sortBy,
          direction: s.direction,
        });
      }
      return out;
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Piles print top to bottom. Merge two piles when they should come off the printer together.
      </p>

      {sections.map((section, i) => {
        const joined = section.entityIds.length > 1;
        return (
          <div key={section.id} className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-4 text-xs font-semibold text-gray-400">{i + 1}</span>
              {/* Every pile is nameable. An earlier version only allowed a name
                  once you had joined types, which was the code deciding what the
                  admin is allowed to want — "Speakers — hand to Carolyn" is a
                  perfectly good name for a pile of one. */}
              <input
                value={section.label}
                onChange={(e) => update(section.id, { label: e.target.value })}
                className="w-56 rounded border border-gray-300 px-2 py-1 text-sm font-medium"
                aria-label="Pile name"
              />
              <span className="text-xs text-gray-500">
                {countOf(section)} {countOf(section) === 1 ? "badge" : "badges"}
              </span>

              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-gray-600">sorted by</span>
                <select
                  value={section.sortBy}
                  onChange={(e) => update(section.id, { sortBy: e.target.value as BadgeSortKey })}
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                  aria-label="Sort by"
                >
                  {BADGE_SORT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {BADGE_SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <select
                  value={section.direction}
                  onChange={(e) =>
                    update(section.id, { direction: e.target.value as "asc" | "desc" })
                  }
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                  aria-label="Direction"
                >
                  <option value="asc">A → Z</option>
                  <option value="desc">Z → A</option>
                </select>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  aria-label="Move pile up"
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === sections.length - 1}
                  aria-label="Move pile down"
                  className="rounded border border-gray-300 px-1.5 py-1 text-xs disabled:opacity-30">↓</button>
              </div>
            </div>

            {/* Contents, shown when the label does not already say them — so an
                untouched pile named after its type shows the name once, and a
                renamed or joined pile shows what is actually in it. */}
            {joined ||
            section.label.trim() !== (typeOf(section.entityIds[0])?.name ?? "").trim() ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                {section.entityIds.map((id) => (
                  <li key={id}
                    className="flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-700 ring-1 ring-gray-200">
                    {typeOf(id)?.name ?? id}
                    <button type="button" onClick={() => separate(section.id, id)}
                      title="Give this its own pile"
                      className="text-gray-400 hover:text-gray-900">×</button>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* ⛔ This was a "Merge into ▾" select listing every other pile.
                With four piles each name then appeared in three dropdowns as
                well as on its own row — thirteen times for one type. Merging
                downward needs no list: reorder with ↑↓ until the two piles are
                adjacent, then merge. Each name is written exactly once. */}
            {i < sections.length - 1 ? (
              <div className="mt-1.5 pl-6">
                <button
                  type="button"
                  onClick={() => mergeInto(section.id, sections[i + 1].id)}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100"
                >
                  ⌄ Merge into the pile below
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await saveAction({ sections });
            setSaving(false);
            setSaved(true);
          }}
          className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save arrangement"}
        </button>
        {saved ? <span className="text-xs text-green-700">Saved</span> : null}
      </div>
    </div>
  );
}
