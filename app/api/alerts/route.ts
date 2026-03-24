import { NextResponse } from "next/server";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

type AlertKind =
  | "content_flag"
  | "legacy_flag"
  | "update_request"
  | "application"
  | "application_status"
  | "invoice"
  | "renewal";

type AlertItem = {
  id: string;
  kind: AlertKind;
  title: string;
  message: string;
  href: string;
  createdAt: string;
  isRead?: boolean;
};

const ALERT_MENU_LIMIT = 10;

function orgHrefFromSlug(slug: string | null | undefined): string {
  return slug ? `/org/${slug}` : "/me";
}

function invoiceTitle(status: string): string {
  if (status === "overdue") return "Invoice overdue";
  if (status === "failed") return "Invoice payment failed";
  if (status === "pending_settlement") return "Invoice pending settlement";
  return "Invoice requires action";
}

function formatDateLabel(date: string | null): string {
  if (!date) return "No due date";
  return date;
}

function renewalTitle(eventType: string): string {
  if (eventType.startsWith("reminder_")) return "Renewal reminder";
  if (eventType === "charge_failed") return "Renewal charge failed";
  if (eventType === "grace_started") return "Membership in grace period";
  if (eventType === "grace_reminder") return "Grace-period reminder";
  if (eventType === "access_locked") return "Membership access locked";
  return "Renewal update";
}

function renewalMessage(eventType: string, orgName: string, renewalYear: number): string {
  if (eventType.startsWith("reminder_")) {
    const days = eventType.replace("reminder_", "");
    return `${orgName}: ${days}-day renewal reminder for ${renewalYear}.`;
  }
  if (eventType === "charge_failed") {
    return `${orgName}: renewal charge attempt failed for ${renewalYear}.`;
  }
  if (eventType === "grace_started") {
    return `${orgName}: membership entered grace period for ${renewalYear}.`;
  }
  if (eventType === "grace_reminder") {
    return `${orgName}: grace period reminder for ${renewalYear}.`;
  }
  if (eventType === "access_locked") {
    return `${orgName}: membership access locked for ${renewalYear}.`;
  }
  return `${orgName}: renewal update (${eventType}) for ${renewalYear}.`;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { activeOrgIds, orgAdminOrgIds, globalRole, userEmail, userId } = auth.ctx;
  const adminClient = createAdminClient();
  const alertItems: AlertItem[] = [];

  const isAdmin = isGlobalAdmin(globalRole);
  const shouldLoadOrgScoped = activeOrgIds.length > 0;
  const shouldLoadFlagScoped = isAdmin || orgAdminOrgIds.length > 0;

  const pendingStatuses = ["pending", "pending_review", "pending_verification"];
  const renewalEventTypes = [
    "charge_failed",
    "grace_started",
    "grace_reminder",
    "access_locked",
    "reminder_30",
    "reminder_14",
    "reminder_7",
    "reminder_0",
  ];

  const recentThresholdIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    updateRequestsRes,
    contentFlagsRes,
    legacyFlagsRes,
    pendingAppsRes,
    myApplicationsRes,
    invoiceAlertsRes,
    renewalEventsRes,
  ] = await Promise.all([
    shouldLoadOrgScoped
      ? adminClient
          .from("update_requests")
          .select("id, message, status, created_at, organization_id")
          .in("organization_id", activeOrgIds)
          .neq("status", "resolved")
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),

    shouldLoadFlagScoped
      ? (isAdmin
          ? adminClient
              .from("content_flags")
              .select("id, field_name, reason, status, created_at, organization_id")
              .is("resolved_at", null)
              .neq("status", "resolved")
              .order("created_at", { ascending: false })
              .limit(8)
          : adminClient
              .from("content_flags")
              .select("id, field_name, reason, status, created_at, organization_id")
              .is("resolved_at", null)
              .neq("status", "resolved")
              .in("organization_id", orgAdminOrgIds)
              .order("created_at", { ascending: false })
              .limit(8))
      : Promise.resolve({ data: [], error: null }),

    shouldLoadFlagScoped
      ? (isAdmin
          ? adminClient
              .from("flags")
              .select("id, page_url, note, priority, status, created_at, organization_id")
              .in("status", ["open", "in_progress"])
              .order("created_at", { ascending: false })
              .limit(8)
          : adminClient
              .from("flags")
              .select("id, page_url, note, priority, status, created_at, organization_id")
              .in("status", ["open", "in_progress"])
              .in("organization_id", orgAdminOrgIds)
              .order("created_at", { ascending: false })
              .limit(8))
      : Promise.resolve({ data: [], error: null }),

    isAdmin
      ? adminClient
          .from("signup_applications")
          .select("id, application_type, applicant_name, status, created_at")
          .in("status", pendingStatuses)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),

    adminClient
      .from("signup_applications")
      .select("id, application_type, applicant_name, status, created_at")
      .or(`user_id.eq.${userId},applicant_email.eq.${userEmail ?? "__none__"}`)
      .in("status", pendingStatuses)
      .gte("created_at", recentThresholdIso)
      .order("created_at", { ascending: false })
      .limit(5),

    shouldLoadOrgScoped
      ? adminClient
          .from("invoices")
          .select(
            `id, status, due_date, total_cents, created_at, organization_id, organization:organizations(name, slug)`
          )
          .in("organization_id", activeOrgIds)
          .in("status", ["invoiced", "pending_settlement", "overdue", "failed"])
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),

    shouldLoadOrgScoped
      ? adminClient
          .from("renewal_events")
          .select(
            `id, event_type, renewal_year, created_at, organization_id, organization:organizations(name, slug)`
          )
          .in("organization_id", activeOrgIds)
          .in("event_type", renewalEventTypes)
          .gte("created_at", recentThresholdIso)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (!updateRequestsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (updateRequestsRes.data ?? []) as Record<string, any>[]) {
      alertItems.push({
        id: `update_request:${row.id}`,
        kind: "update_request",
        title: "Update request pending",
        message: row.message,
        href: "/admin/content",
        createdAt: row.created_at,
      });
    }
  }

  if (!contentFlagsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (contentFlagsRes.data ?? []) as Record<string, any>[]) {
      alertItems.push({
        id: `content_flag:${row.id}`,
        kind: "content_flag",
        title: "Content flagged",
        message: row.reason || `Field ${row.field_name} was flagged`,
        href: "/admin/content",
        createdAt: row.created_at || new Date().toISOString(),
      });
    }
  }

  if (!legacyFlagsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (legacyFlagsRes.data ?? []) as Record<string, any>[]) {
      const isHighPriority = row.priority === "high";
      alertItems.push({
        id: `legacy_flag:${row.id}`,
        kind: "legacy_flag",
        title: isHighPriority ? "High-priority site flag" : "Site flag pending",
        message: row.note || row.page_url || "A site issue was flagged for review.",
        href: "/admin/content",
        createdAt: row.created_at || new Date().toISOString(),
      });
    }
  }

  if (!pendingAppsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (pendingAppsRes.data ?? []) as Record<string, any>[]) {
      alertItems.push({
        id: `application:${row.id}`,
        kind: "application",
        title: "New signup application",
        message: `${row.applicant_name || "Applicant"} (${row.application_type}) is ${row.status}.`,
        href: "/admin/ops",
        createdAt: row.created_at || new Date().toISOString(),
      });
    }
  }

  if (!myApplicationsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (myApplicationsRes.data ?? []) as Record<string, any>[]) {
      alertItems.push({
        id: `application_status:${row.id}`,
        kind: "application_status",
        title: "Application status",
        message: `${row.applicant_name || "Application"} (${row.application_type}) is ${row.status}.`,
        href: "/me",
        createdAt: row.created_at || new Date().toISOString(),
      });
    }
  }

  if (!invoiceAlertsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (invoiceAlertsRes.data ?? []) as Record<string, any>[]) {
      const orgName = row.organization?.name || "Organization";
      const orgSlug = row.organization?.slug;
      const total = (row.total_cents / 100).toFixed(2);
      alertItems.push({
        id: `invoice:${row.id}`,
        kind: "invoice",
        title: invoiceTitle(row.status),
        message: `${orgName}: $${total} CAD due ${formatDateLabel(row.due_date)}.`,
        href: orgHrefFromSlug(orgSlug),
        createdAt: row.created_at,
      });
    }
  }

  if (!renewalEventsRes.error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (renewalEventsRes.data ?? []) as Record<string, any>[]) {
      const orgName = row.organization?.name || "Organization";
      const orgSlug = row.organization?.slug;
      alertItems.push({
        id: `renewal:${row.id}`,
        kind: "renewal",
        title: renewalTitle(row.event_type),
        message: renewalMessage(row.event_type, orgName, row.renewal_year),
        href: orgHrefFromSlug(orgSlug),
        createdAt: row.created_at,
      });
    }
  }

  alertItems.sort((a, b) => {
    const aTs = new Date(a.createdAt).getTime();
    const bTs = new Date(b.createdAt).getTime();
    return bTs - aTs;
  });

  const deduped = Array.from(new Map(alertItems.map((item) => [item.id, item])).values());

  // Load read state for this user
  const alertKeys = deduped.map((item) => item.id);
  const readSet = new Set<string>();
  if (alertKeys.length > 0) {
    const { data: readRows } = await adminClient
      .from("user_alert_reads")
      .select("alert_key")
      .eq("user_id", userId)
      .in("alert_key", alertKeys);
    for (const row of readRows ?? []) {
      readSet.add((row as { alert_key: string }).alert_key);
    }
  }

  const itemsWithReadState = deduped.map((item) => ({
    ...item,
    isRead: readSet.has(item.id),
  }));

  const totalCount = itemsWithReadState.length;
  const unreadCount = itemsWithReadState.filter((item) => !item.isRead).length;
  const limited = itemsWithReadState.slice(0, ALERT_MENU_LIMIT);

  return NextResponse.json(
    {
      items: limited,
      counts: {
        update_requests: updateRequestsRes.data?.length ?? 0,
        content_flags: contentFlagsRes.data?.length ?? 0,
        legacy_flags: legacyFlagsRes.data?.length ?? 0,
        applications_admin_pending: pendingAppsRes.data?.length ?? 0,
        applications_my_status: myApplicationsRes.data?.length ?? 0,
        invoices: invoiceAlertsRes.data?.length ?? 0,
        renewals: renewalEventsRes.data?.length ?? 0,
      },
      total: totalCount,
      unreadCount,
    },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = auth.ctx;
  const adminClient = createAdminClient();

  let body: { alertKeys?: string[] } = {};
  try {
    body = (await request.json()) as { alertKeys?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const alertKeys = body.alertKeys;
  if (!Array.isArray(alertKeys) || alertKeys.length === 0) {
    return NextResponse.json({ error: "alertKeys array required" }, { status: 400 });
  }

  // Upsert read records (ignore conflicts for idempotency)
  const rows = alertKeys.slice(0, 100).map((key) => ({
    user_id: userId,
    alert_key: key,
    read_at: new Date().toISOString(),
  }));

  const { error } = await adminClient
    .from("user_alert_reads")
    .upsert(rows, { onConflict: "user_id,alert_key", ignoreDuplicates: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
