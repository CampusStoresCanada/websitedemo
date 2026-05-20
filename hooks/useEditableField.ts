"use client";

import { useMemo } from "react";
import { editAnchorId, type EditableTable, type EditableColumn } from "@/lib/editable-fields";

/**
 * Returns the standard set of HTML attributes for an inline-editable field.
 *
 * Spread onto any element to make it targetable by the Toolkit edit overlay
 * and the second-signer review mode.
 *
 * Usage:
 *   const { editProps } = useEditableField({ table: "site_content", column: "hero_title", entityId: entity.id });
 *   <h1 {...editProps}>{entity.hero_title}</h1>
 *
 * TypeScript constrains `column` to the allowlisted columns for the given `table`.
 * If a column isn't in EDITABLE_COLUMNS, the type error surfaces here at build time —
 * you'll need to add it to lib/editable-fields.ts (which also updates the server allowlist).
 */
export function useEditableField<T extends EditableTable>({
  table,
  column,
  entityId,
  orgId,
}: {
  table: T;
  column: EditableColumn<T>;
  entityId: string;
  /** Pass the org's UUID when this field is on an org page (/org/[slug]).
   *  Org-page edits bypass the second-signer queue and write immediately.
   *  Omit for site-wide content (site_content, static pages). */
  orgId?: string;
}) {
  const anchorId = useMemo(
    () => editAnchorId(table, column as string, entityId),
    [table, column, entityId]
  );

  const editProps = useMemo(
    () => ({
      id: anchorId,
      "data-field": `${table}.${column}`,
      "data-entity-id": entityId,
      "data-flaggable": true,
      ...(orgId ? { "data-org-id": orgId } : {}),
    }),
    [anchorId, table, column, entityId, orgId]
  );

  return { editProps, anchorId };
}
