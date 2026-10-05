"use client";

import { useState } from "react";
import {
  addCategory,
  removeCategory,
  setCategorySplit,
  updateCategoryLine,
  setCategoryLocation,
  setCategoryBuyers,
  type SurveyCategory,
  type CategoryScope,
} from "@/lib/actions/benchmarking-categories";
import BusyButton from "./BusyButton";
import {
  departmentsFor,
  subcategoriesFor,
  DEPARTMENT_NOTES,
  COURSE_MATERIAL_FORMAT_NOTES,
  NON_PHYSICAL_FORMATS,
} from "@/lib/benchmarking/categories";
import type { StoreContact } from "@/lib/actions/benchmarking-respondent";
import type { SurveyLocation } from "@/lib/actions/benchmarking-locations";

/**
 * Sales by category — the shape §2 and §3 share.
 *
 * Replaces a fixed set of columns that claimed to follow the NACS taxonomy and
 * did not: eight merchandise lines against thirteen departments, with no
 * Graduation & Regalia, no Accessories, no Campus Living, and a "custom merch"
 * line that is not a department at all.
 *
 * A store now says what it carries, whether it wants a department broken out,
 * and gives the same measures either way. Nothing is asked about a category the
 * store does not stock, which is why this is shorter to fill in than the fixed
 * grid it replaces despite covering more.
 */

/*
  Column headings carry their unit, and abbreviations are spelled out.

  "Opening inv." saved eight characters and cost the reader the two facts that
  decide what goes in the box: that it is a dollar value and not a unit count,
  and that it is measured at a fiscal year end rather than a calendar one. A
  store whose year ends in April read "first day of the year" as January.
*/
const MEASURES = [
  {
    key: "retailSales" as const,
    label: "Retail sales",
    unit: "$",
    help: "In-store sales for the fiscal year, in dollars. Exclude tax.",
  },
  {
    key: "onlineSales" as const,
    label: "Online sales",
    unit: "$",
    help: "Sold through your web store, in dollars. Exclude tax. Counted separately from Retail, not inside it.",
  },
  {
    key: "grossMarginPct" as const,
    label: "Gross margin",
    unit: "%",
    help: "Achieved gross margin on this category, not your target. As a percentage of the sales beside it.",
  },
  {
    key: "inventoryOpen" as const,
    label: "Opening inventory",
    unit: "$",
    help: "At cost, on the FIRST day of your fiscal year — the year you are reporting, not the calendar year. This is last year's closing figure.",
  },
  {
    key: "inventoryClose" as const,
    label: "Closing inventory",
    unit: "$",
    help: "At cost, on the LAST day of your fiscal year. The figure your year-end count or your system produced, before any write-down you booked elsewhere.",
  },
];

const UNIT_MEASURES = [
  { key: "unitsSold" as const, label: "Units sold", unit: "#", help: "Physical units only." },
  {
    key: "unitsAvailable" as const,
    label: "Units available",
    unit: "#",
    help: "What you had to sell across the year: opening stock plus everything received. Divided into Units sold, this gives sell-through.",
  },
];

export default function CategorySales({
  benchmarkingId,
  scope,
  initialCategories,
  locations,
  contacts,
  isReadOnly,
}: {
  benchmarkingId: string;
  scope: CategoryScope;
  initialCategories: SurveyCategory[];
  locations: SurveyLocation[];
  contacts: StoreContact[];
  isReadOnly: boolean;
}) {
  const [cats, setCats] = useState<SurveyCategory[]>(initialCategories);
  const [error, setError] = useState<string | null>(null);

  const notes = scope === "course_materials" ? COURSE_MATERIAL_FORMAT_NOTES : DEPARTMENT_NOTES;
  const available = departmentsFor(scope).filter(
    (d) => !cats.some((c) => c.department === d),
  );

  const patch = (id: string, fn: (c: SurveyCategory) => SurveyCategory) =>
    setCats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  async function add(department: string) {
    const res = await addCategory({ benchmarkingId, scope, department });
    if (!res.success || !res.id) {
      setError(res.error ?? "Could not add that.");
      return;
    }
    setCats((prev) => [
      ...prev,
      {
        id: res.id!,
        department,
        splitBySubcategory: false,
        buyerContactIds: [],
        lines: [
          {
            id: res.lineId!,
            subcategory: null,
            retailSales: null,
            onlineSales: null,
            grossMarginPct: null,
            inventoryOpen: null,
            inventoryClose: null,
            unitsSold: null,
            unitsAvailable: null,
          },
        ],
        locations: [],
      },
    ]);
  }

  return (
    <div className="mb-6">
      <div className="space-y-5">
        {cats.map((cat) => {
          const subs = subcategoriesFor(cat.department, scope);
          const withUnits =
            scope === "course_materials" &&
            !(NON_PHYSICAL_FORMATS as readonly string[]).includes(cat.department);
          const shown = cat.splitBySubcategory
            ? cat.lines.filter((l) => l.subcategory !== null)
            : cat.lines.filter((l) => l.subcategory === null);

          return (
            /*
              data-flaggable on the CATEGORY, which is the thing a store would
              question — "what counts as Course Materials, Digital?" — and the
              unit that carries a name a reviewer can act on.

              ⛔ The toolkit's Flag only ever selects elements carrying this
              attribute, by click and by drag alike, so a section without one is
              not merely hard to flag, it is inert: the overlay opens, nothing
              highlights, and nothing happens. Every specialised editor in this
              survey was in that state, including both category sections, which
              are the ones the invitation email tells people to flag. Jackie
              Nguyen reported it from here.

              Not the whole section panel and not each cell: the first is
              thousands of pixels tall and reduces to "section 3 is confusing",
              the second captures a number with no question attached.
            */
            <div
              key={cat.id}
              data-flaggable
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">{cat.department}</h4>
                  {notes[cat.department] && (
                    <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-gray-500">
                      {notes[cat.department]}
                    </p>
                  )}
                </div>
                {!isReadOnly && (
                  <BusyButton
                    onClick={async () => {
                      const res = await removeCategory({ benchmarkingId, categoryId: cat.id });
                      if (res.success) setCats((p) => p.filter((c) => c.id !== cat.id));
                    }}
                    busyLabel="Removing…"
                    className="text-xs text-gray-500 underline hover:text-red-700"
                  >
                    We don&apos;t carry this
                  </BusyButton>
                )}
              </div>

              {subs.length > 0 && (
                <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={cat.splitBySubcategory}
                    disabled={isReadOnly}
                    onChange={async (e) => {
                      const split = e.target.checked;
                      patch(cat.id, (c) => ({ ...c, splitBySubcategory: split }));
                      const res = await setCategorySplit({
                        benchmarkingId,
                        categoryId: cat.id,
                        scope,
                        split,
                        subcategories: subs,
                      });
                      /*
                        The rows are made server-side, so we take them back
                        rather than guessing at them. ⛔ Never a page reload:
                        saves here are debounced by 800ms and a reload would
                        discard whatever was typed last.
                      */
                      if (res.category) {
                        const fresh = res.category;
                        patch(cat.id, () => fresh);
                      } else if (res.error) {
                        setError(res.error);
                      }
                    }}
                  />
                  Break this into subcategories
                </label>
              )}

              {/* The measures, one row whole or one row per subcategory. */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="pb-1 pr-3 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        {cat.splitBySubcategory ? "Subcategory" : "Whole department"}
                      </th>
                      {[...MEASURES, ...(withUnits ? UNIT_MEASURES : [])].map((m) => (
                        <th
                          key={m.key}
                          title={m.help}
                          className="cursor-help px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500"
                        >
                          {m.label}{" "}
                          <span className="font-normal normal-case text-gray-400">
                            ({m.unit})
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((line) => (
                      <tr key={line.id}>
                        <td className="py-1 pr-3 text-xs text-gray-700">
                          {line.subcategory ?? cat.department}
                        </td>
                        {[...MEASURES, ...(withUnits ? UNIT_MEASURES : [])].map((m) => (
                          <td key={m.key} className="px-1 py-1">
                            <input
                              type="number"
                              value={
                                (line as unknown as Record<string, number | null>)[m.key] ?? ""
                              }
                              disabled={isReadOnly}
                              onFocus={(e) => {
                                const el = e.currentTarget;
                                requestAnimationFrame(() => el.select());
                              }}
                              onChange={(e) =>
                                patch(cat.id, (c) => ({
                                  ...c,
                                  lines: c.lines.map((l) =>
                                    l.id === line.id
                                      ? {
                                          ...l,
                                          [m.key]:
                                            e.target.value === "" ? null : Number(e.target.value),
                                        }
                                      : l,
                                  ),
                                }))
                              }
                              onBlur={(e) =>
                                void updateCategoryLine({
                                  benchmarkingId,
                                  lineId: line.id,
                                  [m.key]: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              className="w-24 rounded border border-gray-300 px-1.5 py-1 text-sm"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Where it is sold, and roughly how much floor it takes. */}
              {locations.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Sold at
                  </p>
                  <div className="mt-1 space-y-1.5">
                    {locations.map((loc) => {
                      const at = cat.locations.find((x) => x.locationId === loc.id);
                      return (
                        <div key={loc.id} className="flex items-center gap-3">
                          <label className="flex min-w-[12rem] items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={Boolean(at)}
                              disabled={isReadOnly}
                              onChange={async (e) => {
                                const present = e.target.checked;
                                patch(cat.id, (c) => ({
                                  ...c,
                                  locations: present
                                    ? [...c.locations, { locationId: loc.id, sqft: null }]
                                    : c.locations.filter((x) => x.locationId !== loc.id),
                                }));
                                await setCategoryLocation({
                                  benchmarkingId,
                                  categoryId: cat.id,
                                  locationId: loc.id,
                                  present,
                                });
                              }}
                            />
                            {loc.name || "Unnamed location"}
                          </label>
                          {at && (
                            <input
                              type="number"
                              value={at.sqft ?? ""}
                              disabled={isReadOnly}
                              placeholder="approx. sq ft"
                              onChange={(e) =>
                                patch(cat.id, (c) => ({
                                  ...c,
                                  locations: c.locations.map((x) =>
                                    x.locationId === loc.id
                                      ? {
                                          ...x,
                                          sqft: e.target.value === "" ? null : Number(e.target.value),
                                        }
                                      : x,
                                  ),
                                }))
                              }
                              onBlur={(e) =>
                                void setCategoryLocation({
                                  benchmarkingId,
                                  categoryId: cat.id,
                                  locationId: loc.id,
                                  present: true,
                                  sqft: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              className="w-32 rounded border border-gray-300 px-2 py-1 text-xs"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Who buys it. Same fact as procurement_info.category_buyers. */}
              <div className="mt-3 border-t border-gray-100 pt-3">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Who buys for this category
                </label>
                {/*
                  More than one, because more than one is the truth. Apparel and
                  Gifts are routinely split between two buyers, and the column
                  behind this has always been an array — the single select was
                  quietly making a store choose which of its buyers to name.
                */}
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1.5">
                  {contacts.map((c) => {
                    const on = cat.buyerContactIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-1.5 text-sm text-gray-800"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={isReadOnly}
                          onChange={async () => {
                            const ids = on
                              ? cat.buyerContactIds.filter((id) => id !== c.id)
                              : [...cat.buyerContactIds, c.id];
                            patch(cat.id, (x) => ({ ...x, buyerContactIds: ids }));
                            await setCategoryBuyers({
                              benchmarkingId,
                              categoryId: cat.id,
                              department: cat.department,
                              contactIds: ids,
                            });
                          }}
                        />
                        {c.name}
                        {c.roleTitle ? (
                          <span className="text-gray-500">— {c.roleTitle}</span>
                        ) : null}
                      </label>
                    );
                  })}
                  {contacts.length === 0 && (
                    <p className="text-xs text-gray-500">
                      We do not have anyone on file for your store yet. Add your people in
                      Section 1 and they will appear here.
                    </p>
                  )}
                </div>
                {cat.buyerContactIds.length === 0 && contacts.length > 0 && (
                  <p className="mt-1 text-[11px] text-gray-500">Nobody assigned.</p>
                )}
                <p className="mt-1 text-[11px] text-gray-500">
                  This also updates your store&apos;s buyer list for vendor partners, so you
                  are confirming it here rather than answering it twice.
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {!isReadOnly && available.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-700">Add a category you carry</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {available.map((d) => (
              /*
                Guarded because this inserts a row. Without it a slow round trip
                invites a second click and the store ends up with two Apparels,
                and nothing downstream knows which one was meant.
              */
              <BusyButton
                key={d}
                onClick={() => add(d)}
                busyLabel={`Adding ${d}…`}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:border-[#163D6D] hover:text-[#163D6D]"
              >
                + {d}
              </BusyButton>
            ))}
          </div>
        </div>
      )}

      {scope === "general_merchandise" && (
        <p className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          Have general merchandise income that does not match these categories? Add it in
          the Other Income section rather than forcing it into the nearest one.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
