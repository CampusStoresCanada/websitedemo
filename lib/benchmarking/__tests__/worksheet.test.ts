import { describe, it, expect } from "vitest";
import { buildWorksheet, type PriorRow } from "../worksheet";
import { DEFAULT_FIELD_CONFIG, type SurveyFieldConfig } from "../default-field-config";

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

describe("the printed sheet shows the full scope", () => {
  /*
    The point of the print-off is to see everything that COULD be asked before
    starting, not the handful of fixed questions. A reader with no idea that
    Course Packs or Graduation & Regalia exist gathers the wrong figures and
    finds out at the keyboard.
  */
  const built = buildWorksheet({
    organizationName: "Test Store",
    fiscalYear: 2026,
    closesAt: null,
    config: DEFAULT_FIELD_CONFIG,
    priorRows: [],
  });

  const section = (id: string) => built.sections.find((s) => s.id === id);

  it("keeps General Merchandise, which has no fixed questions left at all", () => {
    const gm = section("general_merchandise");
    expect(gm).toBeDefined();
    expect(gm!.lines).toHaveLength(0);
    expect(gm!.lists.length).toBeGreaterThan(0);
  });

  it("prints every general merchandise category a store could carry", () => {
    const choices = section("general_merchandise")!.lists[0].choices!.map((c) => c.label);
    for (const expected of ["Apparel", "Graduation & Regalia", "Technology & Electronics"]) {
      expect(choices).toContain(expected);
    }
  });

  it("prints every course material format, and says which have no unit counts", () => {
    const formats = section("course_materials")!.lists[0].choices!;
    const labels = formats.map((c) => c.label);
    expect(labels).toContain("Print — New");
    expect(labels).toContain("Course Packs");

    // The label stays the format's name; the caveat sits in the note beside it,
    // so the grid's first column reads as a list of formats rather than a list
    // of formats with parenthetical asides.
    const digital = formats.find((c) => c.label === "Digital");
    expect(digital?.note).toMatch(/no copies to count/);
  });

  it("asks course materials everything it asks general merchandise", () => {
    /*
      The category grid is one component serving both sections, and neither
      "Sold at" nor "Buyer" is scope-gated in it. The sheet printed them for §2
      only, so a store gathering on paper collected them for one section and met
      them cold in the other.
    */
    const columnsIn = (id: string) =>
      section(id)!
        .lists.flatMap((l) => l.columns ?? [])
        .join(" | ");

    for (const shared of ["Retail sales ($)", "Gross margin (%)", "Sold at (location)", "Buyer (name)"]) {
      expect(columnsIn("general_merchandise")).toContain(shared);
      expect(columnsIn("course_materials")).toContain(shared);
    }
  });

  it("splits the wide grids so they fit a printed page", () => {
    // Name column plus six measures came to eight columns, which does not fit
    // the printable width of a portrait page.
    for (const id of ["general_merchandise", "course_materials"]) {
      const tables = section(id)!.lists.filter((l) => l.columns);
      expect(tables.length).toBeGreaterThan(1);
      for (const table of tables) {
        expect(table.columns!.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it("puts the note above the questions, not after ten of them", () => {
    const profile = buildWorksheet({
      organizationName: "Test Store",
      fiscalYear: 2026,
      closesAt: null,
      config: DEFAULT_FIELD_CONFIG,
      priorRows: [],
      knownPeople: [{ name: "Dana Okonkwo", roleTitle: null }],
      organizationSlug: "test-store",
    }).sections.find((s) => s.id === "institution_profile")!;

    expect(profile.lists[0].lead).toBe(true);
    // Everything else in the section prints below the questions.
    expect(profile.lists.slice(1).every((l) => !l.lead)).toBe(true);
  });

  it("puts the pay grid on paper, which the hidden config fields could not", () => {
    const pay = section("staffing")!.lists.find((l) => l.nameColumn === "Employment type");
    expect(pay).toBeDefined();
    expect(pay!.rowLabels).toContain("Full-time");
    expect(pay!.columns).toContain("Wages ($)");
  });

  it("asks for opening hours, which the sheet used to omit entirely", () => {
    const hours = section("institution_profile")!.lists.find((l) =>
      l.title.startsWith("Opening hours"),
    );
    expect(hours).toBeDefined();
    expect(hours!.rowLabels).toContain("monday");
  });

  it("states the unit on every square footage column", () => {
    const locations = section("institution_profile")!.lists.find(
      (l) => l.title === "Your locations",
    )!;
    const footage = locations.columns!.filter((c) =>
      /Sales floor|Storage|Office|Other space/.test(c),
    );
    expect(footage).toHaveLength(4);
    for (const col of footage) expect(col).toMatch(/sq ft/);
  });

  it("gives the free-form lists ruled rows rather than a vocabulary", () => {
    const income = section("other_income")!.lists[0];
    expect(income.choices).toBeUndefined();
    expect(income.blankRows).toBeGreaterThan(0);
    expect(income.columns).toContain("Cost to deliver ($)");
  });
});

describe("the sheet prints what we already hold", () => {
  /*
    A store should not be writing out its own staff list on paper when we are
    holding it. The columns left blank are the ones we genuinely do not know.
  */
  const withPeople = buildWorksheet({
    organizationName: "Test Store",
    fiscalYear: 2026,
    closesAt: null,
    config: DEFAULT_FIELD_CONFIG,
    priorRows: [],
    knownPeople: [
      { name: "Dana Okonkwo", roleTitle: "Course Materials Buyer" },
      { name: "Sam Reid", roleTitle: null },
    ],
    knownDates: [
      { kind: "adoption_deadline", label: "Fall adoption deadline", occursOn: "2026-06-15", endsOn: null },
    ],
    organizationSlug: "test-store",
  });

  /*
    At the FRONT, in Institution Profile, not two thirds of the way down under
    Staffing. The note beside it says to correct the list before starting, which
    is only useful if the reader meets it before starting.
  */
  /*
    Two separate things, and conflating them was the mistake.

    The ROSTER is a staffing question and lives there. What lives at the front
    is the one sentence that saves a store the most time, and only if it is read
    before starting rather than two thirds of the way down.
  */
  const team = (w: typeof withPeople) =>
    w.sections.find((s) => s.id === "staffing")!.lists.find((l) => l.title === "Your team")!;

  const leadNote = (w: typeof withPeople) =>
    w.sections
      .find((s) => s.id === "institution_profile")!
      .lists.find((l) => l.lead)!;

  it("lists the people by name, with their job titles", () => {
    expect(team(withPeople).rowLabels).toEqual([
      "Dana Okonkwo (Course Materials Buyer)",
      "Sam Reid",
    ]);
  });

  it("leaves blank only the columns we cannot know", () => {
    expect(team(withPeople).columns).toEqual([
      "Employment type",
      "Years in campus retail",
    ]);
  });

  it("sends them to their own organisation page before anything else", () => {
    const note = leadNote(withPeople);
    expect(note.lead).toBe(true);
    expect(note.intro).toContain("campusstores.ca/org/test-store");
    expect(note.intro).toContain("before you begin");
    // Names, so they can see at a glance whether it is wrong.
    expect(note.choices!.map((c) => c.label)).toContain("Sam Reid");
  });

  it("pre-fills a known date across the row, not just its name", () => {
    const dates = withPeople.sections
      .find((s) => s.id === "institution_profile")!
      .lists.find((l) => l.title === "Your year ahead")!;
    // [what you call it, kind, date, ends]
    expect(dates.rowCells![0]).toEqual([
      "Fall adoption deadline",
      "Textbook adoption deadline",
      "2026-06-15",
      "",
    ]);
  });

  it("asks a store with nobody on file to add them, and still gives it room", () => {
    const empty = buildWorksheet({
      organizationName: "Test Store",
      fiscalYear: 2026,
      closesAt: null,
      config: DEFAULT_FIELD_CONFIG,
      priorRows: [],
      organizationSlug: "test-store",
    });
    expect(leadNote(empty).intro).toContain("We have nobody on file");
    const block = team(empty);
    expect(block.rowLabels).toEqual([]);
    expect(block.extraBlankRows).toBeGreaterThan(4);
  });
});
