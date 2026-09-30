import { describe, it, expect } from "vitest";
import { FIELD_REGISTRY } from "@/lib/benchmarking/field-registry";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";
import type { FieldConfig } from "@/lib/benchmarking/default-field-config";

/**
 * The survey has two lists of allowed answers and they have to be the same one.
 *
 * The field config decides what a store SEES in a dropdown; the registry decides
 * what the save action ACCEPTS. They drifted five times in a single rebuild, and
 * every time the symptom was identical and baffling: a store picks an option
 * that is right there on the screen, and the form rejects it.
 *
 * Nothing about that is visible to tsc, to a reviewer, or to anyone who is not
 * holding both files open at once — which is why it kept happening.
 */

const allFields: FieldConfig[] = DEFAULT_FIELD_CONFIG.sections.flatMap((s) => s.fields);

describe("field config and save registry", () => {
  it("never offers an option the save action would reject", () => {
    const problems: string[] = [];

    for (const field of allFields) {
      const def = FIELD_REGISTRY[field.name];
      if (!def || !field.options) continue;
      // allowOther means the list is a prompt rather than a closed set, so an
      // unlisted value is accepted by design.
      if (def.allowOther) continue;
      if (!def.options) continue;

      const rejected = field.options.filter((o) => !def.options!.includes(o));
      if (rejected.length > 0) {
        problems.push(`${field.name}: config offers ${JSON.stringify(rejected)}, registry does not accept them`);
      }
    }

    expect(problems).toEqual([]);
  });

  it("agrees with the registry about which fields are lists", () => {
    const problems: string[] = [];

    for (const field of allFields) {
      const def = FIELD_REGISTRY[field.name];
      if (!def) continue;
      const configIsList = field.type === "multiselect";
      const registryIsList = def.type === "multiselect";
      if (configIsList !== registryIsList) {
        problems.push(
          `${field.name}: config says ${field.type}, registry says ${def.type} — one writes an array and the other a string`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it("has a registry entry for every visible field a store can answer", () => {
    const missing = allFields
      .filter((f) => f.visible !== false)
      .filter((f) => !f.calculated && !f.displayOnly)
      .filter((f) => !f.name.startsWith("_calc"))
      .filter((f) => !FIELD_REGISTRY[f.name])
      .map((f) => f.name);

    expect(missing).toEqual([]);
  });
});
