// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Custom Variable Extraction
// A template's variable_keys used to be a hand-typed declaration, kept
// in sync with the body by the admin. That's redundant — the body
// already says which {{tokens}} it uses — so this scans the actual
// content instead, the same way extractConditionKeys() already does for
// {{#if}} blocks. Whatever's left after subtracting the known
// system/catalog variables is what still needs an admin-typed value.
// Pure/client-safe — no server-only imports.
// ─────────────────────────────────────────────────────────────────

import { SYSTEM_VARIABLE_KEYS } from "./registry";
import { CONDITION_SUBJECTS } from "../conditions/registry";

/** Every {{key}} the system already knows how to auto-fill for at least some audience. */
export function getKnownVariableKeys(): Set<string> {
  const keys = new Set<string>(SYSTEM_VARIABLE_KEYS);
  for (const [subjectKey, subjectDef] of Object.entries(CONDITION_SUBJECTS)) {
    for (const fieldKey of Object.keys(subjectDef.fields)) {
      keys.add(`${subjectKey}_${fieldKey}`);
    }
  }
  return keys;
}

/**
 * Every {{word}} token in a string — the exact same shape renderTemplate()
 * substitutes, so this always agrees with what actually gets replaced.
 * Control tokens like {{#if x}} / {{/if}} contain non-word characters
 * (#, space, /) and never match \w+-only content, so they're correctly
 * excluded without any special-casing.
 */
export function extractVariableTokens(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
}

/** The subset of a template's {{tokens}} (across subject + body) that aren't already system/catalog variables — these are what need an admin-typed value per campaign. */
export function extractCustomVariableKeys(...texts: string[]): string[] {
  const known = getKnownVariableKeys();
  const custom = new Set<string>();
  for (const text of texts) {
    for (const key of extractVariableTokens(text)) {
      if (!known.has(key)) custom.add(key);
    }
  }
  return [...custom].sort();
}
