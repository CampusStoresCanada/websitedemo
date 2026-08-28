import { describe, it, expect } from "vitest";
import { buildWorksheet, type PriorRow } from "../worksheet";
import type { SurveyFieldConfig } from "../default-field-config";

const config: SurveyFieldConfig = {
  sections: [
    {
      id: "sales",
      title: "Sales",
      order: 1,
      fields: [
        {
          name: "total_gross_sales_instore",
          label: "In-store sales",
          type: "currency",
          order: 2,
          visible: true,
          required: true,
          helpText: "Walk-in purchases only.",
        },
        {
          name: "margin_pct",
          label: "Gross margin",
          type: "percentage",
          order: 3,
          visible: true,
        },
        {
          name: "computed_total",
          label: "Total revenue",
          type: "currency",
          order: 1,
          visible: true,
          calculated: { formula: "a+b", format: "currency" },
        },
        {
          name: "hidden_field",
          label: "Retired question",
          type: "number",
          order: 4,
          visible: false,
        },
        {
          name: "ia_detail",
          label: "IA revenue",
          type: "currency",
          order: 5,
          visible: true,
          showIf: { field: "has_ia", value: true },
        },
        {
          name: "has_ia",
          label: "Do you run Inclusive Access?",
          type: "boolean",
          order: 6,
          visible: true,
        },
      ],
    },
    {
      id: "all_calculated",
      title: "Derived",
      order: 2,
      fields: [
        {
          name: "derived_only",
          label: "Derived",
          type: "number",
          order: 1,
          visible: true,
          calculated: { formula: "x", format: "number" },
        },
      ],
    },
  ],
};

const base = {
  organizationName: "Test University",
  fiscalYear: 2026,
  closesAt: "2026-11-21T08:00:00+00",
  config,
};

describe("worksheet assembly", () => {
  it("omits calculated fields — the form does that arithmetic, not the reader", () => {
    const w = buildWorksheet({ ...base, priorRows: [] });
    const names = w.sections.flatMap((s) => s.lines.map((l) => l.name));
    expect(names).not.toContain("computed_total");
  });

  it("omits invisible fields and drops a section left with nothing to gather", () => {
    const w = buildWorksheet({ ...base, priorRows: [] });
    const names = w.sections.flatMap((s) => s.lines.map((l) => l.name));
    expect(names).not.toContain("hidden_field");
    expect(w.sections.map((s) => s.id)).not.toContain("all_calculated");
  });

  it("keeps conditional fields but explains the condition — paper cannot hide a row", () => {
    const w = buildWorksheet({ ...base, priorRows: [] });
    const ia = w.sections[0].lines.find((l) => l.name === "ia_detail");
    expect(ia).toBeDefined();
    expect(ia!.conditionHint).toContain("Do you run Inclusive Access?");
  });

  it("orders sections and fields the way the survey asks them", () => {
    const w = buildWorksheet({ ...base, priorRows: [] });
    expect(w.sections[0].lines[0].name).toBe("total_gross_sales_instore");
  });
});

describe("historic values", () => {
  const priors: PriorRow[] = [
    {
      fiscal_year: 2025,
      total_gross_sales_instore: 2145678.42,
      margin_pct: 23.456,
      has_ia: true,
    },
    { fiscal_year: 2024, total_gross_sales_instore: 1980000, margin_pct: null },
  ];

  it("prints prior years most-recent-first", () => {
    const w = buildWorksheet({ ...base, priorRows: priors });
    expect(w.priorYears).toEqual([2025, 2024]);
  });

  it("formats currency without cents and percentages without noise", () => {
    const w = buildWorksheet({ ...base, priorRows: priors });
    const sales = w.sections[0].lines.find((l) => l.name === "total_gross_sales_instore")!;
    const margin = w.sections[0].lines.find((l) => l.name === "margin_pct")!;
    expect(sales.priorValues[0]).toBe("$2,145,678");
    expect(margin.priorValues[0]).toBe("23.5%");
  });

  it("renders a year the store did not answer as null, not zero", () => {
    const w = buildWorksheet({ ...base, priorRows: priors });
    const margin = w.sections[0].lines.find((l) => l.name === "margin_pct")!;
    // 2024 had no margin. A blank must never print as "0%" — that reads as a
    // reported figure and invites a delta flag against a number nobody gave us.
    expect(margin.priorValues[1]).toBeNull();
  });

  it("renders booleans as Yes/No", () => {
    const w = buildWorksheet({ ...base, priorRows: priors });
    const ia = w.sections[0].lines.find((l) => l.name === "has_ia")!;
    expect(ia.priorValues[0]).toBe("Yes");
  });

  it("never pulls a future or current year into the history columns", () => {
    const w = buildWorksheet({
      ...base,
      priorRows: [...priors, { fiscal_year: 2026, total_gross_sales_instore: 999 }],
    });
    expect(w.priorYears).not.toContain(2026);
  });

  it("caps the columns so the sheet still fits a page", () => {
    const many: PriorRow[] = [2025, 2024, 2023, 2022].map((y) => ({ fiscal_year: y }));
    const w = buildWorksheet({ ...base, priorRows: many, maxPriorYears: 2 });
    expect(w.priorYears).toEqual([2025, 2024]);
  });

  it("flags a store with no history rather than printing a column of dashes", () => {
    const w = buildWorksheet({ ...base, priorRows: [] });
    expect(w.noHistory).toBe(true);
    expect(w.priorYears).toEqual([]);
    // 15 of the 52 active member stores are in exactly this position.
    expect(w.sections[0].lines[0].priorValues).toEqual([]);
  });
});
