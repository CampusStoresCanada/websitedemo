"use client";

import { useState, useTransition } from "react";
import { updateField } from "@/lib/actions/update-field";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";
import { splitStoredSelection } from "@/lib/publication/categories";

// CategoryEditor uses the same taxonomy as the member procurement section
// so that partner primary_category values map 1:1 to member procurement categories.
const TAXONOMY: Record<string, readonly string[]> = Object.fromEntries(
  VENDOR_CATEGORIES.map((cat) => [cat, CATEGORY_SUBCATEGORIES[cat] ?? []])
);

function parentCategory(label: string): string | null {
  for (const [cat, subs] of Object.entries(TAXONOMY)) {
    if ((subs as readonly string[]).includes(label)) return cat;
  }
  return null;
}

// ---------------------------------------------------------------------------

interface CategoryEditorProps {
  orgId: string;
  orgName: string;
  currentValue: string | null;
  primaryColor: string;
  /** AI-computed NACS department — shown as "Likely" suggestions */
  nacsDepartment: string | null;
  /** AI-computed NACS classes — shown as "Likely" suggestions */
  nacsClasses: string[] | null;
  onClose: () => void;
  onSaved: (newValue: string) => void;
}

export default function CategoryEditor({
  orgId,
  orgName,
  currentValue,
  primaryColor,
  nacsDepartment,
  nacsClasses,
  onClose,
  onSaved,
}: CategoryEditorProps) {
  /**
   * ⛔ EVERY CHIP AT THE TOP MUST HAVE A CONTROL AT THE BOTTOM.
   *
   * The stored value can hold terms from an older vocabulary. They rendered as
   * ordinary secondaries, but no checkbox in the list corresponds to them — so
   * the two halves of this dialog looked unrelated, and the only way to get rid
   * of one was the chip's own × button, which nobody would think to look for.
   *
   * Worse, it is how the double-vocabulary rows happened: someone ticked the
   * modern category, the invisible legacy term stayed, and every save carried it
   * forward. RAINS ended up holding "Apparel & Spirit Wear" AND "Apparel".
   *
   * So on load: leave recognised terms exactly as chosen, expand renamed ones
   * through the shared ALIASES so they land on a real control, and put anything
   * still unrecognised in its own group that SAYS it is not in the list.
   *
   * ⚠️ Only LEGACY tokens are expanded. A recognised class stays a class — if a
   * partner picked only "Men's / Unisex", resolving that to Apparel as well
   * would silently change what they said their primary was.
   */
  /**
   * ⛔ Every chip at the top must have a control at the bottom — see
   * `splitStoredSelection`. Legacy terms used to render as ordinary secondaries
   * with no matching checkbox anywhere, which is why the two halves of this
   * dialog looked unrelated and why unrecognised terms rode along on every save.
   */
  const { selected: initialSelected, legacy: legacyTerms } =
    splitStoredSelection(currentValue);

  const [selected, setSelected] = useState<string[]>(initialSelected);
  /**
   * Terms the taxonomy cannot place at all — "General Merchandise", "Other".
   * Held separately so they are VISIBLE rather than masquerading as choices,
   * and still saved unless the partner drops them: this dialog must not delete
   * what somebody declared just because we no longer have a word for it.
   */
  const [legacy, setLegacy] = useState<string[]>(legacyTerms);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // -------------------------------------------------------------------------
  // Likely categories — AI suggestions minus anything already selected
  // -------------------------------------------------------------------------
  const likelySuggestions: string[] = (() => {
    const suggestions: string[] = [];
    if (nacsDepartment) suggestions.push(nacsDepartment);
    if (nacsClasses) suggestions.push(...nacsClasses);
    return suggestions.filter((s) => !selected.includes(s));
  })();

  // -------------------------------------------------------------------------
  // Selection helpers
  // -------------------------------------------------------------------------

  const isSelected = (label: string) => selected.includes(label);

  const toggle = (label: string) => {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const addLikely = (label: string) => {
    if (!selected.includes(label)) setSelected((prev) => [...prev, label]);
  };

  const remove = (label: string) => {
    setSelected((prev) => prev.filter((l) => l !== label));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setSelected((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    setSelected((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const handleSave = () => {
    setError(null);
    // Unplaceable terms are preserved, at the end, unless explicitly removed.
    const newValue = [...selected, ...legacy].join(", ");
    startTransition(async () => {
      const result = await updateField({
        table: "organizations",
        column: "primary_category",
        entityId: orgId,
        newValue: newValue || null,
        orgId,
        entityDisplayName: orgName,
      });
      if (!result.success) {
        setError(result.error ?? "Failed to save");
        return;
      }
      onSaved(newValue);
    });
  };

  // -------------------------------------------------------------------------
  // Shared badge renderer
  // -------------------------------------------------------------------------

  const primaryBadge = (label: string) => (
    <span
      className="px-4 py-1 rounded-full text-sm font-semibold flex-shrink-0"
      style={{ color: primaryColor, boxShadow: `0 0 0 2px white, 0 0 0 4px ${primaryColor}` }}
    >
      {label}
    </span>
  );

  const secondaryBadge = (label: string) => (
    <span className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 border border-gray-300 bg-white flex-shrink-0">
      {label}
    </span>
  );

  const primary = selected[0] ?? null;
  const secondaries = selected.slice(1);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-[#1A1A1A]">Edit Categories</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Select one primary and any number of secondaries.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col overflow-hidden flex-1 min-h-0">

          {/* Current selection — Primary / Secondary sections */}
          <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0 space-y-4">

            {/* Primary */}
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: primaryColor }}>
                Primary
              </p>
              {primary ? (
                <div className="flex items-center gap-3 group">
                  {primaryBadge(primary)}
                  <button
                    onClick={() => remove(primary)}
                    className="p-1 rounded text-gray-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-auto"
                    aria-label="Remove primary"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">First selection becomes the primary</p>
              )}
            </div>

            {/* Secondary */}
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
                Secondary
              </p>
              {secondaries.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Additional selections appear here</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {secondaries.map((label, i) => {
                    const realIndex = i + 1; // index in the full selected array
                    return (
                      <div key={label} className="flex items-center gap-2 group">
                        {/* Reorder */}
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => moveUp(realIndex)}
                            className="p-0.5 rounded text-gray-300 hover:text-gray-600 transition-colors"
                            aria-label="Move up"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => moveDown(realIndex)}
                            disabled={realIndex === selected.length - 1}
                            className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
                            aria-label="Move down"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                        {secondaryBadge(label)}
                        {/* Promote to primary */}
                        <button
                          onClick={() => moveUp(realIndex)}
                          className="text-xs text-gray-300 hover:text-gray-500 transition-colors opacity-0 group-hover:opacity-100"
                          title="Make primary"
                        >
                          ↑ Primary
                        </button>
                        {/* Remove */}
                        <button
                          onClick={() => remove(label)}
                          className="p-1 rounded text-gray-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-auto"
                          aria-label={`Remove ${label}`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Scrollable taxonomy area */}
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">

            {/* Terms with no home in the current taxonomy */}
            {legacy.length > 0 && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-xs uppercase tracking-wider text-amber-700 font-semibold mb-1">
                  Not in the current list
                </p>
                <p className="text-xs text-amber-800 mb-3">
                  These were chosen before the categories changed. Pick the closest
                  match below, then remove them — they are kept until you do.
                </p>
                <div className="flex flex-wrap gap-2">
                  {legacy.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border border-amber-300 bg-white text-amber-900"
                    >
                      {label}
                      <button
                        onClick={() => setLegacy((prev) => prev.filter((l) => l !== label))}
                        className="text-amber-500 hover:text-amber-800"
                        aria-label={`Remove ${label}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Likely categories — AI suggestions not yet selected */}
            {likelySuggestions.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-3">
                  Likely Categories
                </p>
                <div className="flex flex-wrap gap-2">
                  {likelySuggestions.map((label) => {
                    const dept = parentCategory(label);
                    return (
                      <button
                        key={label}
                        onClick={() => addLikely(label)}
                        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:border-gray-500 hover:text-gray-700 transition-colors bg-white"
                        title={dept ? `${dept} › ${label}` : undefined}
                      >
                        <svg className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Full NACS taxonomy */}
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-4">
                Categories
              </p>
              <div className="space-y-5">
                {Object.entries(TAXONOMY).map(([dept, classes]) => {
                  const deptSelected = isSelected(dept);
                  return (
                    <div key={dept}>
                      {/* Department */}
                      <button
                        onClick={() => toggle(dept)}
                        className={`
                          flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg transition-colors text-sm font-semibold
                          ${deptSelected
                            ? "bg-[#1A1A1A] text-white"
                            : "bg-gray-50 text-[#1A1A1A] hover:bg-gray-100"}
                        `}
                      >
                        <span className={`
                          flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center
                          ${deptSelected ? "bg-white border-white" : "border-gray-300"}
                        `}>
                          {deptSelected && (
                            <svg className="w-3 h-3 text-[#1A1A1A]" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </span>
                        {dept}
                      </button>
                      {/* Classes */}
                      <div className="flex flex-wrap gap-2 mt-2 ml-3">
                        {classes.map((cls) => {
                          const clsSelected = isSelected(cls);
                          return (
                            <button
                              key={cls}
                              onClick={() => toggle(cls)}
                              className={`
                                px-3 py-1 rounded-full text-xs font-medium transition-all border
                                ${clsSelected
                                  ? "border-[#1A1A1A] bg-[#1A1A1A] text-white"
                                  : "border-gray-200 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700"}
                              `}
                            >
                              {cls}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : (
            <p className="text-xs text-gray-400">
              {selected.length === 0
                ? "No categories selected"
                : `1 primary · ${secondaries.length} secondary`}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-[#1A1A1A] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: primaryColor }}
            >
              {isPending ? "Saving…" : "Save Categories"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
