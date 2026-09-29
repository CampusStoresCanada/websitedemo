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
import { departmentsFor, subcategoriesFor, DEPARTMENT_NOTES } from "@/lib/benchmarking/categories";
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

const MEASURES = [
  { key: "retailSales" as const, label: "Retail", prefix: "$", help: "In-store sales for the year." },
  { key: "onlineSales" as const, label: "Online", prefix: "$", help: "Sold through your web store." },
  { key: "grossMarginPct" as const, label: "GM %", suffix: "%", help: "Achieved gross margin, not your target." },
  { key: "inventoryOpen" as const, label: "Opening inv.", prefix: "$", help: "At cost, first day of the year." },
  { key: "inventoryClose" as const, label: "Closing inv.", prefix: "$", help: "At cost, last day of the year." },
];

const UNIT_MEASURES = [
  { key: "unitsSold" as const, label: "Units sold", help: "Physical units only." },
  { key: "unitsAvailable" as const, label: "Units available", help: "What you had to sell. Gives sell-through." },
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

  const withUnits = scope === "course_materials";
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
          const shown = cat.splitBySubcategory
            ? cat.lines.filter((l) => l.subcategory !== null)
            : cat.lines.filter((l) => l.subcategory === null);

          return (
            <div key={cat.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">{cat.department}</h4>
                  {DEPARTMENT_NOTES[cat.department] && (
                    <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-gray-500">
                      {DEPARTMENT_NOTES[cat.department]}
                    </p>
                  )}
                </div>
                {!isReadOnly && (
                  <button
                    onClick={async () => {
                      const res = await removeCategory({ benchmarkingId, categoryId: cat.id });
                      if (res.success) setCats((p) => p.filter((c) => c.id !== cat.id));
                    }}
                    className="text-xs text-gray-500 underline hover:text-red-700"
                  >
                    We don&apos;t carry this
                  </button>
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
                      await setCategorySplit({
                        benchmarkingId,
                        categoryId: cat.id,
                        split,
                        subcategories: subs,
                      });
                      // Rows are created server-side; reload rather than guess.
                      window.location.reload();
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
                          className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500"
                        >
                          {m.label}
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
                <select
                  value={cat.buyerContactIds[0] ?? ""}
                  disabled={isReadOnly}
                  onChange={async (e) => {
                    const ids = e.target.value ? [e.target.value] : [];
                    patch(cat.id, (c) => ({ ...c, buyerContactIds: ids }));
                    await setCategoryBuyers({
                      benchmarkingId,
                      categoryId: cat.id,
                      department: cat.department,
                      contactIds: ids,
                    });
                  }}
                  className="mt-1 w-full max-w-sm rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">Nobody assigned</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.roleTitle ? ` — ${c.roleTitle}` : ""}
                    </option>
                  ))}
                </select>
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
              <button
                key={d}
                onClick={() => void add(d)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:border-[#163D6D] hover:text-[#163D6D]"
              >
                + {d}
              </button>
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
