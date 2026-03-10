export type ScheduleModuleKey =
  | "meetings"
  | "trade_show"
  | "education"
  | "meals"
  | "offsite"
  | "custom"
  | "registration_ops"
  | "communications"
  | "sponsorship_ops"
  | "logistics"
  | "travel_accommodation"
  | "content_capture"
  | "lead_capture"
  | "compliance_safety"
  | "staffing"
  | "post_event"
  | "virtual_hybrid"
  | "expo_floor_plan";

export type OccupancyModuleKey =
  | "meetings"
  | "trade_show"
  | "education"
  | "meals"
  | "offsite"
  | "travel_accommodation";

export type OccupancyMode = "no" | "included" | "purchase_required";

type RegistrationOptionLike = {
  id?: unknown;
  linked_product_ids?: unknown;
  entitlements?: unknown;
  [key: string]: unknown;
};

type OffsiteEventLike = {
  linked_product_id?: unknown;
  [key: string]: unknown;
};

const OCCUPANCY_KEYS: OccupancyModuleKey[] = [
  "meetings",
  "trade_show",
  "education",
  "meals",
  "offsite",
  "travel_accommodation",
];

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRegistrationOptions(
  value: unknown
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];

  const seenIds = new Map<string, number>();
  return value
    .map((item, idx) => {
      if (!isRecord(item)) return null;
      const option = { ...(item as RegistrationOptionLike) };

      const baseId =
        typeof option.id === "string" && option.id.trim()
          ? option.id.trim()
          : `registration-option-${idx + 1}`;
      const seenCount = seenIds.get(baseId) ?? 0;
      seenIds.set(baseId, seenCount + 1);
      const normalizedId = seenCount === 0 ? baseId : `${baseId}-${seenCount + 1}`;

      const linked = Array.isArray(option.linked_product_ids)
        ? uniqueStrings(
            option.linked_product_ids.filter(
              (entry): entry is string => typeof entry === "string"
            )
          )
        : [];

      const entitlements = isRecord(option.entitlements)
        ? option.entitlements
        : {};
      const normalizedEntitlements = OCCUPANCY_KEYS.reduce<
        Partial<Record<OccupancyModuleKey, OccupancyMode>>
      >((acc, key) => {
        const raw = entitlements[key];
        if (raw === "no" || raw === "included" || raw === "purchase_required") {
          acc[key] = raw;
        }
        return acc;
      }, {});

      return {
        ...option,
        id: normalizedId,
        linked_product_ids: linked,
        entitlements: normalizedEntitlements,
      } as Record<string, unknown>;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function normalizeOffsiteEvents(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const event = { ...(item as OffsiteEventLike) };
      return {
        ...event,
        linked_product_id:
          typeof event.linked_product_id === "string" && event.linked_product_id.trim()
            ? event.linked_product_id
            : null,
      } as Record<string, unknown>;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

export function normalizeModuleConfig(
  moduleKey: ScheduleModuleKey,
  config: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...config };
  if (moduleKey === "registration_ops") {
    if (Object.prototype.hasOwnProperty.call(next, "registration_options")) {
      next.registration_options = normalizeRegistrationOptions(next.registration_options);
    }
  }
  if (moduleKey === "offsite") {
    if (Object.prototype.hasOwnProperty.call(next, "offsite_events")) {
      next.offsite_events = normalizeOffsiteEvents(next.offsite_events);
    }
  }
  return next;
}

export function normalizeScheduleModulesInput<
  T extends {
    module_key: ScheduleModuleKey;
    enabled: boolean;
    config_json?: Record<string, unknown>;
  },
>(modules: T[]): Array<T & { config_json: Record<string, unknown> }> {
  return modules.map((moduleDef) => ({
    ...moduleDef,
    config_json: normalizeModuleConfig(
      moduleDef.module_key,
      (moduleDef.config_json ?? {}) as Record<string, unknown>
    ),
  }));
}

export function getPurchaseRequiredModuleKeysFromRegistrationConfig(
  registrationConfig: Record<string, unknown>
): Set<OccupancyModuleKey> {
  const keys = new Set<OccupancyModuleKey>();
  const options = normalizeRegistrationOptions(registrationConfig.registration_options);
  for (const option of options) {
    const entitlements = isRecord(option.entitlements) ? option.entitlements : {};
    for (const key of OCCUPANCY_KEYS) {
      if (entitlements[key] === "purchase_required") {
        keys.add(key);
      }
    }
  }
  return keys;
}
