import type {
  FieldConfig,
  SurveyFieldConfig,
} from "@/lib/benchmarking/default-field-config";
import { describeShowIf } from "@/lib/benchmarking/show-if";
import {
  departmentsFor,
  subcategoriesFor,
  DEPARTMENT_NOTES,
  COURSE_MATERIAL_FORMAT_NOTES,
  NON_PHYSICAL_FORMATS,
} from "@/lib/benchmarking/categories";
import { KEY_DATE_KINDS, DAYS } from "@/lib/benchmarking/key-dates";
import { STORE_SERVICES } from "@/lib/types/procurement";
import { COMPETITOR_KINDS } from "@/lib/benchmarking/competitor-kinds";
import { EMPLOYMENT_TYPES } from "@/lib/benchmarking/systems";
import { LOCATION_KINDS } from "@/lib/benchmarking/location-kinds";

/**
 * The printable gathering sheet.
 *
 * A store director does not fill this survey at a keyboard — they fill it after
 * walking a P&L, a POS export and an HR headcount into one place. The worksheet
 * exists so that walk happens once, on paper, before anyone opens the form.
 *
 * It carries last year's answers deliberately. Two reasons, and the second is
 * the one that changes the data:
 *
 *   - it saves the store finding a figure it already gave us, and
 *   - it surfaces a definition change before it becomes a delta flag. A store
 *     that sees "last year you reported $2.1M here" and knows this year's
 *     figure is $4M has been told, on paper, that something needs explaining —
 *     which is far cheaper than a reviewer phoning in November to ask.
 *
 * Only ever the reader's own history. Nothing in this module takes another
 * store's figures, and the caller scopes the query to one organization.
 */

export interface WorksheetLine {
  name: string;
  label: string;
  /**
   * Caption for a pair of fields that answer one question together.
   *
   * On screen these render side by side under one heading. The sheet was
   * printing them as two separate questions called "Month" and "Day", with
   * nothing anywhere saying month of what — the fiscal year end, the single
   * answer that makes every other figure readable, had no label at all.
   */
  rowLabel?: string;
  rowHelpText?: string;
  type: FieldConfig["type"];
  helpText?: string;
  example?: string;
  exampleCredit?: string;
  suffix?: string;
  /** For select / multiselect: printed so the reader can circle or tick one. */
  options?: string[];
  required: boolean;
  group?: string;
  indent: number;
  /** "Only if you answered X to Y" — a printed sheet cannot hide a field. */
  conditionHint?: string;
  /** Formatted prior answers, index-aligned with `Worksheet.priorYears`. */
  priorValues: (string | null)[];
}

/**
 * A part of the survey that is a LIST rather than a set of fixed questions.
 *
 * ⛔ The printed sheet has to show the whole vocabulary. On screen a store adds
 * the categories it carries and never sees the rest; on paper there is nobody
 * to click, so a sheet that printed only the default questions left a reader
 * with no idea that Graduation & Regalia or Course Packs were even askable.
 * The point of the print-off is to see the full scope before starting.
 */
export interface WorksheetList {
  title: string;
  intro: string;
  /** Everything the store could pick, so the scope is visible on paper. */
  choices?: { label: string; note?: string }[];
  /** Figures wanted for each thing they pick. */
  columns?: string[];
  /** Ruled lines for a list with no fixed vocabulary. */
  blankRows?: number;
  /** Pre-printed first column, one row each. */
  rowLabels?: string[];
  /** Ruled rows after the labelled ones, for subcategory splits. */
  extraBlankRows?: number;
  /** Heading for the pre-printed first column. */
  nameColumn?: string;
}

export interface WorksheetSection {
  id: string;
  title: string;
  description?: string;
  lines: WorksheetLine[];
  lists: WorksheetList[];
}

export interface Worksheet {
  organizationName: string;
  fiscalYear: number;
  closesAt: string | null;
  /** Most recent first. Empty for a store that has never filed. */
  priorYears: number[];
  sections: WorksheetSection[];
  lineCount: number;
  /**
   * True when we hold no prior submission at all. Fifteen of the 52 active
   * member stores are in this position, so the sheet says so rather than
   * printing a column of dashes and looking broken.
   */
  noHistory: boolean;
}

export type PriorRow = Record<string, unknown> & { fiscal_year: number };

function formatValue(value: unknown, type: FieldConfig["type"]): string | null {
  if (value === null || value === undefined || value === "") return null;

  switch (type) {
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      // No cents. These are millions-scale figures and the decimals are noise
      // on a sheet someone is reading across a desk.
      return `$${Math.round(n).toLocaleString("en-CA")}`;
    }
    case "percentage": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return `${Number(n.toFixed(1))}%`;
    }
    case "number":
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return n.toLocaleString("en-CA");
    }
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : null;
    case "multiselect": {
      // text[] column — String() on an array gives "a,b" with no spaces.
      if (!Array.isArray(value)) return String(value).trim() || null;
      const picked = value.filter(Boolean).map(String);
      return picked.length ? picked.join(", ") : null;
    }
    default: {
      const s = String(value).trim();
      if (!s) return null;
      // A long free-text answer is not useful in a narrow print column, and
      // truncating silently would misrepresent what they said last year.
      return s.length > 80 ? `${s.slice(0, 77)}…` : s;
    }
  }
}

function conditionHint(field: FieldConfig, config: SurveyFieldConfig): string | undefined {
  if (!field.showIf) return undefined;
  const target = config.sections
    .flatMap((s) => s.fields)
    .find((f) => f.name === field.showIf!.field);
  const label = target?.label ?? field.showIf.field;
  return describeShowIf(field.showIf, label);
}

function indentLevel(field: FieldConfig): number {
  if (typeof field.indent === "number") return field.indent;
  return field.indent ? 1 : 0;
}

/**
 * Which fields earn a line on paper.
 *
 * Calculated fields are excluded: the form works them out, so printing a blank
 * box invites someone to compute a total by hand and then wonder why the screen
 * disagrees. Display-only fields are excluded for the same reason — there is
 * nothing to gather.
 */
function isGatherable(field: FieldConfig): boolean {
  if (field.visible === false) return false;
  if (field.calculated) return false;
  if (field.displayOnly) return false;
  return true;
}


/**
 * The list-driven parts of each section, with their full vocabularies.
 *
 * Read from the same modules the form renders from, so a category added to the
 * taxonomy appears on the printed sheet without anybody remembering to update
 * it here. A printed survey that has drifted from the real one is worse than no
 * printed survey: a store gathers the wrong figures and only finds out at the
 * keyboard.
 */
function listsForSection(sectionId: string): WorksheetList[] {
  switch (sectionId) {
    case "institution_profile":
      return [
        {
          title: "Who is filling this in",
          intro:
            "The person who actually pulled the figures together, so a question in November reaches them and not the account holder. You pick them from your store's contacts on screen; write the name here while you are gathering.",
          columns: ["Name", "Job title", "Email", "Phone"],
          blankRows: 1,
        },
        {
          title: "Your locations",
          intro:
            "One row per place you operate. The web store is not a location. Square footage is asked per location and the survey adds it up for you, so you never type a total.",
          choices: LOCATION_KINDS.map((k) => ({ label: k.label, note: k.help })),
          columns: [
            "Name",
            "Kind",
            "Sales floor (sq ft)",
            "Storage (sq ft)",
            "Office (sq ft)",
            "Other space (sq ft, and what it is)",
          ],
          blankRows: 4,
        },
        {
          /*
            Absent from the printed sheet entirely until now, which meant a
            store gathering on paper walked into seven days of opening and
            closing times it had not collected.
          */
          title: "Opening hours, for each permanent location with a sales floor",
          intro:
            "Term-time hours. Leave a day blank if you are closed. Asked per location, so copy this grid for each permanent shop. Not asked for seasonal or warehouse space.",
          nameColumn: "Location:",
          columns: ["Opens", "Closes"],
          rowLabels: [...DAYS],
        },
        {
          title: "Services you run",
          intro:
            "Tick what you offer now, and mark with a P anything you are planning to add and an S anything you are stopping. Each service you offer becomes an income line in Other Income.",
          choices: STORE_SERVICES.map((label) => ({ label })),
        },
        {
          title: "Your year ahead",
          intro:
            "The dates your year turns on, for the year COMING, not the one you are reporting. Add as many of each as you need: one adoption deadline per term, every buyback window, each semester.",
          choices: KEY_DATE_KINDS.map((k) => ({ label: k.label, note: k.help })),
          columns: ["Kind", "What you call it", "Date", "Ends (if a window)"],
          blankRows: 6,
        },
        {
          title: "Who competes with you",
          intro:
            "Stores on campus, or close enough that a student would go there instead. One row each. None at all is an answer too.",
          choices: COMPETITOR_KINDS.map((k) => ({ label: k.label, note: k.help })),
          columns: ["Name", "What kind"],
          blankRows: 4,
        },
      ];

    case "general_merchandise": {
      const departments = departmentsFor("general_merchandise").map((d) => {
        const subs = subcategoriesFor(d, "general_merchandise");
        const note = [
          DEPARTMENT_NOTES[d],
          subs.length ? `You may split this into: ${subs.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return { label: d, note: note || undefined };
      });
      return [
        {
          title: "Every category you could carry",
          intro:
            "Tick the ones you sell, then fill the two tables below for each. You may break any of them into the subcategories listed under it, in which case give the figures per subcategory rather than for the department as a whole.",
          choices: departments,
        },
        {
          /*
            Split in two at a seam that means something. All six measures plus a
            name column came to eight columns, which does not fit the printable
            width of a portrait page: every figure ended up in about 22mm, and a
            seven-digit number does not go in 22mm in handwriting.
          */
          title: "Sales and margin, by category",
          intro:
            "Blank rows are for subcategory splits. Write the subcategory name in the first column and give its figures instead of the department's.",
          nameColumn: "Category",
          columns: ["Retail sales ($)", "Online sales ($)", "Gross margin (%)"],
          rowLabels: departments.map((d) => d.label),
          extraBlankRows: 6,
        },
        {
          title: "Inventory and who handles it, by category",
          intro:
            "Inventory at COST, on the first and last day of your fiscal year. Sold at is which of your locations carries it; Buyer is whoever does the buying, and the survey uses that to confirm your buyer list for vendor partners.",
          nameColumn: "Category",
          columns: [
            "Opening inventory ($)",
            "Closing inventory ($)",
            "Sold at (location)",
            "Buyer (name)",
          ],
          rowLabels: departments.map((d) => d.label),
          extraBlankRows: 6,
        },
      ];
    }

    case "course_materials": {
      const formats = departmentsFor("course_materials").map((d) => ({
        label: d,
        note:
          [
            COURSE_MATERIAL_FORMAT_NOTES[d],
            (NON_PHYSICAL_FORMATS as readonly string[]).includes(d)
              ? "No unit counts for this one: there are no copies to count."
              : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      }));
      return [
        {
          title: "Every format you could sell",
          intro:
            "Course materials are asked by FORMAT, because the same textbook is new print in September, a rental in January and a digital licence in an Inclusive Access cohort, and the figures differ every time.",
          choices: formats,
        },
        {
          title: "Sales and margin, by format",
          intro: "The same columns as General Merchandise, so the two add up together.",
          nameColumn: "Format",
          columns: ["Retail sales ($)", "Online sales ($)", "Gross margin (%)"],
          rowLabels: formats.map((f) => f.label),
        },
        {
          title: "Inventory and units, by format",
          intro:
            "Units for the physical formats only. Units available means opening stock plus everything you received, which is what sell-through divides into.",
          nameColumn: "Format",
          columns: [
            "Opening inventory ($)",
            "Closing inventory ($)",
            "Units sold (count)",
            "Units available (count)",
          ],
          rowLabels: formats.map((f) => f.label),
        },
        {
          /*
            Asked of course materials on screen exactly as it is of general
            merchandise, and missing from the printed sheet for §3 alone. A
            store gathering on paper would have collected it for one section and
            been surprised by it in the other.
          */
          title: "Where it sells and who buys it, by format",
          intro:
            "Sold at is which of your locations carries it. Buyer is whoever does the buying, and the survey uses that to confirm your buyer list for vendor partners, so you are not asked it twice.",
          nameColumn: "Format",
          columns: ["Sold at (location)", "Buyer (name)"],
          rowLabels: formats.map((f) => f.label),
        },
      ];
    }

    case "other_income":
      return [
        {
          title: "Income lines",
          intro:
            "Money booked through your store that is not merchandise. Every service you told us you offer gets a line of its own on screen. Do NOT include money the institution collects that does not appear in your financial statements; that is asked in Inclusive & Equitable Access.",
          columns: [
            "What it is",
            "Earned ($)",
            "Cost to deliver ($)",
            "Cost already in Expenses?",
            "Counts as income?",
          ],
          blankRows: 6,
        },
      ];

    case "staffing":
      return [
        {
          /*
            Four to eight figures that did not appear on the printed sheet at
            all: the config fields behind this grid were hidden when the grid
            replaced them, and isGatherable quite correctly skipped them. A
            store gathering on paper had no idea it needed wages by employment
            type.
          */
          title: "What your people cost",
          intro:
            "Wages only in the first column. The benefits column is asked only if your STORE pays them; leave it blank where your institution carries the cost centrally, because that blank is itself the answer.",
          nameColumn: "Employment type",
          columns: ["Wages ($)", "Benefits the store pays ($)"],
          rowLabels: EMPLOYMENT_TYPES.map((t) => t.label),
        },
        {
          title: "Your team",
          intro:
            "One row per person, started from the people we already hold for your store. Years in campus retail means anywhere, not just with you.",
          choices: EMPLOYMENT_TYPES.map((t) => ({ label: t.label })),
          columns: ["Name", "Employment type", "Years in campus retail"],
          blankRows: 8,
        },
      ];

    case "technology_systems":
      return [
        {
          /*
            Asked on screen whenever "who runs it" is answered with somebody on
            staff, and absent from the sheet entirely. Optional there and
            optional here: plenty of stores will not want a student employee
            named in a national association's records.
          */
          title: "Who runs your social, by name",
          intro:
            "Only if the answer above is somebody on your own staff. Optional, and skipping it costs you nothing. It exists so a peer asking how a campaign went reaches the person who ran it rather than your general inbox.",
          columns: ["Name", "Job title"],
          blankRows: 1,
        },
      ];

    case "expenses":
      return [
        {
          title: "Anything we did not name",
          intro:
            "Only what does not belong on one of the expense lines above. Use the name you use internally; we will show it back to you that way.",
          columns: ["What it is", "Amount ($)"],
          blankRows: 4,
        },
      ];

    default:
      return [];
  }
}

export function buildWorksheet(input: {
  organizationName: string;
  fiscalYear: number;
  closesAt: string | null;
  config: SurveyFieldConfig;
  /** Every prior submission we hold for THIS organization. Any order. */
  priorRows: PriorRow[];
  /** How many prior years to print. More than three will not fit the page. */
  maxPriorYears?: number;
}): Worksheet {
  const {
    organizationName,
    fiscalYear,
    closesAt,
    config,
    priorRows,
    maxPriorYears = 2,
  } = input;

  const priors = [...priorRows]
    .filter((r) => r.fiscal_year < fiscalYear)
    .sort((a, b) => b.fiscal_year - a.fiscal_year)
    .slice(0, maxPriorYears);

  const priorYears = priors.map((r) => r.fiscal_year);

  const sections: WorksheetSection[] = [...config.sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      lines: [...section.fields]
        .filter(isGatherable)
        .sort((a, b) => a.order - b.order)
        .map((field) => ({
          name: field.name,
          label: field.label,
          rowLabel: field.rowLabel,
          rowHelpText: field.rowHelpText,
          type: field.type,
          helpText: field.helpText,
          example: field.example,
          exampleCredit: field.exampleCredit,
          suffix: field.suffix,
          options: field.options,
          required: field.required === true,
          group: field.group,
          indent: indentLevel(field),
          conditionHint: conditionHint(field, config),
          priorValues: priors.map((row) => formatValue(row[field.name], field.type)),
        })),
      lists: listsForSection(section.id),
    }))
    /*
      Kept if it has questions OR lists. §2 General Merchandise has no scalar
      fields left at all since the category grid replaced them, so filtering on
      questions alone printed a survey with its largest section missing.
    */
    .filter((s) => s.lines.length > 0 || s.lists.length > 0);

  return {
    organizationName,
    fiscalYear,
    closesAt,
    priorYears,
    sections,
    lineCount: sections.reduce((n, s) => n + s.lines.length, 0),
    noHistory: priors.length === 0,
  };
}
