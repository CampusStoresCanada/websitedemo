import { describe, it, expect } from "vitest";
import {
  isSafeColumnName,
  addColumnSql,
  validateNewQuestion,
  existingFieldNames,
  RESERVED_FIELD_NAMES,
} from "../add-question";
import type { SurveyFieldConfig } from "../default-field-config";

const config: SurveyFieldConfig = {
  sections: [
    {
      id: "course_materials",
      title: "Course Materials Breakdown",
      order: 5,
      fields: [
        {
          name: "cm_inclusive_access_total",
          label: "IA/EA — course materials value (Total)",
          type: "currency",
          order: 11,
          visible: true,
        },
      ],
    },
  ],
};

describe("the column name is the security boundary", () => {
  // exec_sql takes a STRING. Its own body only checks the statement starts with
  // ALTER TABLE ... ADD COLUMN — everything after that is whatever we hand it.
  // So this regex is the only thing between the editor and arbitrary DDL inside
  // the clause.
  it("accepts an ordinary column name", () => {
    expect(isSafeColumnName("cm_ia_delivery_model")).toBe(true);
    expect(isSafeColumnName("abc")).toBe(true);
  });

  it("refuses anything that could carry DDL through", () => {
    for (const bad of [
      "drop_table; DROP TABLE benchmarking",
      "name varchar, add column sneaky text",
      'name" text; --',
      "name)",
      "name--",
      "a b",
      "name'",
    ]) {
      expect(isSafeColumnName(bad)).toBe(false);
    }
  });

  it("refuses names Postgres would fold, quote or truncate", () => {
    expect(isSafeColumnName("MixedCase")).toBe(false);
    expect(isSafeColumnName("1starts_with_digit")).toBe(false);
    expect(isSafeColumnName("_leading_underscore")).toBe(false);
    expect(isSafeColumnName("ab")).toBe(false); // too short to mean anything
    // Well inside Postgres's 63-char identifier limit, so two questions can
    // never truncate into the same column.
    expect(isSafeColumnName("a".repeat(55))).toBe(true);
    expect(isSafeColumnName("a".repeat(56))).toBe(false);
  });

  it("throws rather than emitting SQL for an unsafe name", () => {
    expect(() => addColumnSql("x; DROP TABLE benchmarking", "text")).toThrow();
  });

  it("emits IF NOT EXISTS so a retry after a half-failure is safe", () => {
    // addSurveyQuestion mints the column and then saves the config. If the
    // second step fails, the admin is told to try again — which re-runs this.
    expect(addColumnSql("cm_ia_delivery_model", "currency")).toBe(
      "ALTER TABLE benchmarking ADD COLUMN IF NOT EXISTS cm_ia_delivery_model numeric",
    );
    expect(addColumnSql("services_offered_extra", "multiselect")).toContain("text[]");
    expect(addColumnSql("runs_own_program", "boolean")).toContain("boolean");
  });
});

describe("what a new question may not be", () => {
  const base = { name: "cm_ia_delivery_model", type: "currency", sectionId: "course_materials", config };

  it("accepts a well-formed new question", () => {
    expect(validateNewQuestion(base)).toBeNull();
  });

  it("refuses a name already in the survey", () => {
    expect(validateNewQuestion({ ...base, name: "cm_inclusive_access_total" })).toBe(
      "duplicate",
    );
  });

  it("refuses the workflow columns", () => {
    // Minting over one of these would hand a respondent their own submitted_at.
    for (const reserved of ["submitted_at", "status", "organization_id", "qa_status"]) {
      expect(RESERVED_FIELD_NAMES.has(reserved)).toBe(true);
      expect(validateNewQuestion({ ...base, name: reserved })).toBe("reserved");
    }
  });

  it("refuses a section that does not exist", () => {
    expect(validateNewQuestion({ ...base, sectionId: "nope" })).toBe("no_section");
  });

  it("refuses an unknown type", () => {
    expect(validateNewQuestion({ ...base, type: "signature" })).toBe("bad_type");
  });
});

describe("existingFieldNames", () => {
  it("spans every section, not just the one being added to", () => {
    const two: SurveyFieldConfig = {
      sections: [
        config.sections[0],
        { id: "staffing", title: "Staffing", order: 4, fields: [
          { name: "fte_total", label: "FTE", type: "number", order: 1, visible: true },
        ] },
      ],
    };
    expect(existingFieldNames(two)).toEqual(
      new Set(["cm_inclusive_access_total", "fte_total"]),
    );
    // A duplicate in ANOTHER section still collides: one column, one table.
    expect(
      validateNewQuestion({ name: "fte_total", type: "number", sectionId: "course_materials", config: two }),
    ).toBe("duplicate");
  });
});
