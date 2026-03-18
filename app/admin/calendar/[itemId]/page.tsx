import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import Link from "next/link";
import CalendarItemDetailClient from "@/components/admin/calendar/CalendarItemDetailClient";
import type { CalendarItem, CalendarItemNote } from "@/lib/calendar/types";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ itemId: string }>;
};

// ── Entity deep-link helper ────────────────────────────────────────

function entityHref(
  type: string | null,
  id: string | null,
  meta: Record<string, unknown> = {}
): string | null {
  if (!type || !id) return null;
  const confId = meta.conference_id as string | undefined;
  switch (type) {
    case "conference_instance":    return `/admin/conference/${id}`;
    case "policy_set":             return `/admin/policy`;
    case "message_campaign":       return `/admin/comms/${id}`;
    case "ops_alert":              return `/admin/ops`;
    case "signup_application":     return `/admin/applications`;
    case "benchmarking_survey":    return `/benchmarking/admin`;
    case "billing_run":            return `/admin/ops`;
    case "conference_legal_version":
      return confId ? `/admin/conference/${confId}/legal` : `/admin/ops`;
    case "conference_program_item":
      return confId ? `/admin/conference/${confId}/schedule-ops` : `/admin/ops`;
    default:                       return null;
  }
}

function entityLabel(type: string | null): string {
  switch (type) {
    case "conference_instance":    return "Conference";
    case "policy_set":             return "Policy Set";
    case "message_campaign":       return "Campaign";
    case "renewal_job_run":        return "Renewal Job";
    case "scheduler_run":          return "Scheduler Run";
    case "retention_job":          return "Retention Job";
    case "ops_alert":              return "Ops Alert";
    case "signup_application":     return "Application";
    case "benchmarking_survey":    return "Benchmarking Survey";
    case "billing_run":            return "Billing Run";
    case "conference_legal_version": return "Legal Version";
    case "conference_program_item":  return "Program Item";
    default:                       return "Source";
  }
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  warning:  "bg-yellow-100 text-yellow-700",
  normal:   "bg-gray-100 text-gray-500",
};

const STATUS_STYLES: Record<string, string> = {
  blocked: "bg-red-50 text-red-700",
  active:  "bg-blue-50 text-blue-700",
  done:    "bg-green-50 text-green-700",
  planned: "bg-gray-50 text-gray-600",
};

const LAYER_LABELS: Record<string, string> = {
  people:     "People",
  admin_ops:  "Admin Ops",
  system_ops: "System Ops",
};

const CATEGORY_LABELS: Record<string, string> = {
  conference:        "Conference",
  renewals_billing:  "Renewals / Billing",
  legal_retention:   "Legal / Retention",
  communications:    "Communications",
  integrations_ops:  "Integrations / Ops",
};

export default async function CalendarItemDetailPage({ params }: PageProps) {
  const { itemId } = await params;

  const supabase = createAdminClient();

  const { data: raw, error } = await supabase
    .from("calendar_items")
    .select("*, owner:profiles!owner_id(id, display_name)")
    .eq("id", itemId)
    .single();

  if (error || !raw) notFound();

  const { data: noteRows } = await supabase
    .from("calendar_item_notes")
    .select("*, actor:profiles!actor_id(id, display_name)")
    .eq("calendar_item_id", itemId)
    .order("created_at", { ascending: true });

  const item: CalendarItem = {
    id:                  raw.id,
    title:               raw.title,
    description:         raw.description ?? null,
    category:            raw.category            as CalendarItem["category"],
    layer:               raw.layer               as CalendarItem["layer"],
    starts_at:           raw.starts_at,
    ends_at:             raw.ends_at ?? null,
    source_mode:         raw.source_mode         as CalendarItem["source_mode"],
    source_key:          raw.source_key ?? null,
    related_entity_type: (raw.related_entity_type ?? null) as CalendarItem["related_entity_type"],
    related_entity_id:   raw.related_entity_id   ?? null,
    owner_id:            raw.owner_id ?? null,
    status:              raw.status              as CalendarItem["status"],
    severity:            raw.severity            as CalendarItem["severity"],
    metadata:            (raw.metadata as Record<string, unknown>) ?? {},
    created_at:          raw.created_at,
    updated_at:          raw.updated_at,
    requires_confirmation: raw.requires_confirmation ?? false,
    confirmed_at:        raw.confirmed_at ?? null,
    confirmed_by:        raw.confirmed_by ?? null,
  };

  const owner = raw.owner as { id: string; display_name: string | null } | null;

  const notes: (CalendarItemNote & {
    actor: { id: string; display_name: string | null } | null;
  })[] = (noteRows ?? []).map((n) => ({
    id:               n.id,
    calendar_item_id: n.calendar_item_id,
    note:             n.note,
    actor_id:         n.actor_id ?? null,
    created_at:       n.created_at,
    actor:            n.actor as { id: string; display_name: string | null } | null,
  }));

  const entityHrefStr  = entityHref(item.related_entity_type, item.related_entity_id, item.metadata);
  const entityLabelStr = entityLabel(item.related_entity_type);

  const dateStr = new Date(item.starts_at).toLocaleString("en-CA", {
    weekday:  "long",
    year:     "numeric",
    month:    "long",
    day:      "numeric",
    hour:     "2-digit",
    minute:   "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  });

  return (
    <main className="max-w-2xl">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-gray-500 flex items-center gap-2">
        <Link href="/admin/calendar" className="hover:underline text-blue-600">
          Calendar
        </Link>
        <span>›</span>
        <span className="truncate text-gray-700">{item.title}</span>
      </nav>

      {/* Title + badges */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[item.severity]}`}>
            {item.severity}
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status]}`}>
            {item.status}
          </span>
          <span className="text-xs text-gray-400">
            {LAYER_LABELS[item.layer]} · {CATEGORY_LABELS[item.category]}
          </span>
          {item.source_mode === "projected" && (
            <span className="text-xs italic text-gray-400">projected</span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>
        {item.description && (
          <p className="mt-2 text-sm text-gray-600">{item.description}</p>
        )}
      </div>

      {/* Meta grid */}
      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 mb-6">
        <dl className="grid grid-cols-2 gap-0 divide-x divide-gray-100">
          <div className="px-4 py-3">
            <dt className="text-xs text-gray-500">Starts</dt>
            <dd className="mt-0.5 text-sm font-medium text-gray-900">{dateStr}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-xs text-gray-500">Owner</dt>
            <dd className="mt-0.5 text-sm font-medium text-gray-900">
              {owner?.display_name ?? "—"}
            </dd>
          </div>
        </dl>
        {item.ends_at && (
          <div className="px-4 py-3">
            <dt className="text-xs text-gray-500">Ends</dt>
            <dd className="mt-0.5 text-sm text-gray-700">
              {new Date(item.ends_at).toLocaleString("en-CA", {
                month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
                timeZone: "America/Toronto", timeZoneName: "short",
              })}
            </dd>
          </div>
        )}
        {entityHrefStr && (
          <div className="px-4 py-3">
            <dt className="text-xs text-gray-500">Source</dt>
            <dd className="mt-0.5">
              <Link href={entityHrefStr} className="text-sm text-blue-600 hover:underline">
                View {entityLabelStr} →
              </Link>
            </dd>
          </div>
        )}
        {Object.keys(item.metadata).length > 0 && (
          <div className="px-4 py-3">
            <dt className="text-xs text-gray-500 mb-1.5">Metadata</dt>
            <dd>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(item.metadata).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-gray-400">{k}</dt>
                    <dd className="text-xs text-gray-700">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </dd>
          </div>
        )}
      </div>

      {/* Interactive: status/owner edits + notes */}
      <CalendarItemDetailClient item={item} notes={notes} />
    </main>
  );
}
