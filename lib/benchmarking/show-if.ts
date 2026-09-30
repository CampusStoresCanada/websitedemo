import type { FieldConfig } from "@/lib/benchmarking/default-field-config";

/**
 * Whether a conditional field should be shown.
 *
 * An array of values means "any of these". Kept in one place because three
 * things read the same condition — the form, the printed worksheet, and the
 * review screen — and a condition that means one thing on screen and another
 * on paper is how a store ends up answering a question it was never shown.
 */
export function matchesShowIf(
  showIf: FieldConfig["showIf"],
  formData: Record<string, unknown>,
): boolean {
  if (!showIf) return true;
  const actual = formData[showIf.field];
  return Array.isArray(showIf.value)
    ? showIf.value.includes(actual)
    : actual === showIf.value;
}

/** The same condition, said in words, for the worksheet and the review list. */
export function describeShowIf(showIf: FieldConfig["showIf"], label: string): string {
  const say = (v: unknown) => (v === true ? "yes" : v === false ? "no" : String(v));
  const value = showIf?.value;
  if (Array.isArray(value)) {
    const parts = value.map(say);
    const last = parts.pop();
    return `Only if “${label}” is ${parts.join(", ")} or ${last}`;
  }
  return `Only if “${label}” is ${say(value)}`;
}
