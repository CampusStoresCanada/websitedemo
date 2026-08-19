import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which glanceable widgets the admin console renders, and in what order.
 *
 * Order and on/off state live in `dashboard_widget_config` (keyed by role), so
 * the dashboard can be rearranged per role without a code change. The registry
 * below is the authority on which keys are *real* — the config table predates
 * the widgets and still holds rows for keys that were never built, so anything
 * not listed here is ignored rather than rendered as a blank slot.
 */

export const DASHBOARD_WIDGETS = [
  { key: "membership", label: "Membership Renewals" },
  { key: "conference", label: "The Conference" },
  { key: "board", label: "The Board" },
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGETS)[number]["key"];

const KNOWN_KEYS = new Set<string>(DASHBOARD_WIDGETS.map((w) => w.key));

function isKnownKey(key: string): key is DashboardWidgetKey {
  return KNOWN_KEYS.has(key);
}

/**
 * Enabled widget keys for a role, in display order.
 *
 * A widget with no config row is still shown — it falls in after the
 * configured ones, in registry order. Adding a widget to the registry
 * therefore lights it up without needing a row inserted first, and only an
 * explicit `enabled = false` hides one.
 */
export async function getDashboardWidgetLayout(role: string): Promise<DashboardWidgetKey[]> {
  const db = createAdminClient();

  const { data } = await db
    .from("dashboard_widget_config")
    .select("widget_key, enabled, display_order")
    .eq("role", role)
    .order("display_order", { ascending: true });

  const ordered: DashboardWidgetKey[] = [];
  const seen = new Set<DashboardWidgetKey>();

  for (const row of data ?? []) {
    if (!isKnownKey(row.widget_key) || seen.has(row.widget_key)) continue;
    seen.add(row.widget_key);
    if (row.enabled) ordered.push(row.widget_key);
  }

  const unconfigured = DASHBOARD_WIDGETS.map((w) => w.key).filter((key) => !seen.has(key));

  return [...ordered, ...unconfigured];
}
