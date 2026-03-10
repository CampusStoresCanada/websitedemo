"use client";

import type { PolicyValue } from "@/lib/policy/types";
import PolicyValueEditor from "./PolicyValueEditor";

interface Props {
  values: PolicyValue[];
  publishedValues: PolicyValue[];
  isEditing: boolean;
  draftSetId: string | null;
}

export default function PolicyTab({
  values,
  publishedValues,
  isEditing,
  draftSetId,
}: Props) {
  const publishedMap = new Map(publishedValues.map((v) => [v.key, v]));

  if (values.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-tertiary)] text-sm">
        No policy values in this category.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {values.map((value) => {
        const published = publishedMap.get(value.key);
        const hasChanged =
          isEditing &&
          published &&
          JSON.stringify(published.value_json) !==
            JSON.stringify(value.value_json);

        return (
          <PolicyValueEditor
            key={value.id}
            value={value}
            publishedValue={published ?? null}
            isEditing={isEditing}
            draftSetId={draftSetId}
            hasChanged={hasChanged ?? false}
          />
        );
      })}
    </div>
  );
}
