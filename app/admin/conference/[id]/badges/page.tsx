import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isGlobalAdmin, requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  advanceBadgePrintJob,
  type DelegateBatchOrderMode,
  type ExhibitorBatchOrderMode,
  createPreprintedBadgeJob,
  deleteBadgePrintJob,
  getBadgeSetupSession,
  listBadgePrintJobs,
  listBadgeTemplateConfigs,
  saveBadgeSetupSession,
  saveBadgeTemplateConfig,
} from "@/lib/actions/conference-badges";
import {
  resolveConferencePersonCanonicalLink,
  setConferencePersonCanonicalLink,
  syncConferencePeopleIndex,
} from "@/lib/actions/conference-people";
import BadgeQuickReprint from "@/components/admin/conference/BadgeQuickReprint";
import BadgeJobsAutoRefresh from "@/components/admin/conference/BadgeJobsAutoRefresh";
import BadgeTemplateEditor from "@/components/admin/conference/BadgeTemplateEditor";
import BadgeSetupWizardStub from "@/components/admin/conference/BadgeSetupWizardStub";
import {
  DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  normalizeBadgeTemplateConfig,
} from "@/lib/conference/badges/template";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BadgeOpsMode = "setup" | "reset" | "studio" | "make";
const DELEGATE_SORT_OPTIONS: Array<{ value: DelegateBatchOrderMode; label: string }> = [
  { value: "delegate_last_name", label: "Last Name" },
  { value: "delegate_first_name", label: "First Name" },
];
const EXHIBITOR_SORT_OPTIONS: Array<{ value: ExhibitorBatchOrderMode; label: string }> = [
  { value: "exhibitor_org_name", label: "Organization Name" },
  { value: "exhibitor_room_number", label: "Room Number" },
];
function parseDelegateBatchOrderMode(value: string): DelegateBatchOrderMode {
  return value === "delegate_first_name" ? "delegate_first_name" : "delegate_last_name";
}
function parseExhibitorBatchOrderMode(value: string): ExhibitorBatchOrderMode {
  return value === "exhibitor_room_number" ? "exhibitor_room_number" : "exhibitor_org_name";
}

function parseBadgeOpsMode(value: string | string[] | undefined): BadgeOpsMode {
  const mode = Array.isArray(value) ? value[0] : value;
  if (mode === "setup" || mode === "reset" || mode === "studio" || mode === "make") {
    return mode;
  }
  return "studio";
}

export default async function ConferenceBadgeOpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return <main className="p-6 text-sm text-red-700">Conference ops access required.</main>;
  }

  const { id: conferenceId } = await params;
  const canRunCanonicalFixes = isGlobalAdmin(auth.ctx.globalRole);
  const query = await searchParams;
  const mode = parseBadgeOpsMode(query.mode);
  const actionStatusRaw = Array.isArray(query.action_status)
    ? query.action_status[0]
    : query.action_status;
  const actionMessageRaw = Array.isArray(query.action_message)
    ? query.action_message[0]
    : query.action_message;
  const actionStatus = actionStatusRaw === "success" || actionStatusRaw === "error" ? actionStatusRaw : null;
  const actionMessage = typeof actionMessageRaw === "string" && actionMessageRaw.trim().length > 0
    ? actionMessageRaw.trim()
    : null;
  const adminClient = createAdminClient();
  const [
    { data: conference },
    jobsResult,
    configsResult,
    setupSessionResult,
    { data: peopleRows },
    { data: canonicalLookupRows },
  ] =
    await Promise.all([
      adminClient
        .from("conference_instances")
        .select("id, name, year, edition_code")
        .eq("id", conferenceId)
        .maybeSingle(),
      listBadgePrintJobs(conferenceId),
      listBadgeTemplateConfigs(conferenceId),
      getBadgeSetupSession(conferenceId),
      adminClient
        .from("conference_people")
        .select(
          "id, canonical_person_id, display_name, contact_email, assigned_email_snapshot, role_title, person_kind, registration_id, organization_id"
        )
        .eq("conference_id", conferenceId)
        .neq("assignment_status", "canceled")
        .order("person_kind", { ascending: true })
        .order("display_name", { ascending: true }),
      adminClient
        .from("people")
        .select("id, first_name, last_name, primary_email")
        .limit(800),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase infers `never` for wide selects
  const conf = conference as Record<string, any> | null;
  if (!conf) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }

  const jobs = jobsResult.success ? jobsResult.data ?? [] : [];
  const configs = configsResult.success ? configsResult.data ?? [] : [];
  const setupSession = setupSessionResult.success ? setupSessionResult.data ?? null : null;
  const requestedTemplateVersion = Number(
    String((Array.isArray(query.template) ? query.template[0] : query.template) ?? "")
  );
  const activeConfigRow = configs.find((row) => row.status === "active") ?? null;
  const latestDraftConfigRow = configs.find((row) => row.status === "draft") ?? null;
  const selectedConfigRow =
    (Number.isFinite(requestedTemplateVersion) && requestedTemplateVersion > 0
      ? configs.find((row) => Number(row.config_version) === requestedTemplateVersion) ?? null
      : null) ??
    (mode === "studio" ? latestDraftConfigRow ?? activeConfigRow ?? configs[0] ?? null : activeConfigRow ?? configs[0] ?? null);
  const selectedConfig = normalizeBadgeTemplateConfig(selectedConfigRow?.field_mapping ?? null);
  const delegateCount = (peopleRows ?? []).filter(
    (row) => String((row as Record<string, unknown>).person_kind ?? "").toLowerCase() !== "exhibitor"
  ).length;
  const exhibitorCount = (peopleRows ?? []).filter(
    (row) => String((row as Record<string, unknown>).person_kind ?? "").toLowerCase() === "exhibitor"
  ).length;

  async function saveTemplateEditorAction(formData: FormData) {
    "use server";
    const versionRaw = Number(String(formData.get("config_version") ?? "1"));
    const nameRaw = String(formData.get("name") ?? "").trim();
    const statusRaw = String(formData.get("status") ?? "draft").trim();
    const mappingRaw = String(formData.get("field_mapping_json") ?? "").trim();
    if (!mappingRaw) return;

    const status =
      statusRaw === "active" || statusRaw === "archived" ? statusRaw : "draft";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(mappingRaw);
    } catch {
      return;
    }
    const normalized = normalizeBadgeTemplateConfig(parsedJson);

    await saveBadgeTemplateConfig({
      conferenceId,
      configVersion: Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1,
      name: nameRaw.length > 0 ? nameRaw : "Default Template",
      status,
      fieldMapping: normalized,
    });
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

  async function setupCreateDraftAction(formData: FormData) {
    "use server";
    const startFrom = String(formData.get("start_from") ?? "blank").trim();
    const preset = String(formData.get("canvas_preset") ?? "oversized").trim();
    const delegateOverlay = String(formData.get("delegate_overlay") ?? "").trim();
    const exhibitorOverlay = String(formData.get("exhibitor_overlay") ?? "").trim();
    const frontTheme = String(formData.get("front_theme") ?? "map_tint").trim();
    const qrMode = String(formData.get("qr_mode") ?? "person_uuid").trim();
    const reprintPipeline = String(formData.get("reprint_pipeline") ?? "pdf").trim();
    const lastStepRaw = Number(String(formData.get("setup_last_step") ?? "3"));

    const db = createAdminClient();
    const { data: latestRows } = await db
      .from("badge_template_configs")
      .select("config_version")
      .eq("conference_id", conferenceId)
      .order("config_version", { ascending: false })
      .limit(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestVersion = Number((latestRows as any)?.[0]?.config_version ?? 0);
    const nextVersion = Number.isFinite(latestVersion) ? latestVersion + 1 : 1;

    const { data: baseCurrentRow } =
      startFrom === "current"
        ? await db
            .from("badge_template_configs")
            .select("field_mapping")
            .eq("conference_id", conferenceId)
            .order("config_version", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

    const nextConfig = normalizeBadgeTemplateConfig(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (startFrom === "current" ? (baseCurrentRow as any)?.field_mapping : null) ??
        DEFAULT_BADGE_TEMPLATE_CONFIG_V1
    );

    if (startFrom !== "current") {
      nextConfig.front.layerSettings = {
        role_visuals: { visible: false, locked: false },
        logo: { visible: false, locked: false },
        organizationLine1: { visible: false, locked: false },
        organizationLine2: { visible: false, locked: false },
        firstName: { visible: false, locked: false },
        lastName: { visible: false, locked: false },
        title: { visible: false, locked: false },
      };
      nextConfig.front.shapes = [];
      nextConfig.front.images = [];
      nextConfig.roles.delegate.frontOverlayUrl = null;
      nextConfig.roles.exhibitor.frontOverlayUrl = null;
      nextConfig.roles.delegate.frontBackgroundUrl = null;
      nextConfig.roles.exhibitor.frontBackgroundUrl = null;
    }
    if (preset === "trimmed") {
      nextConfig.canvas.widthIn = 3;
      nextConfig.canvas.heightIn = 5;
      nextConfig.canvas.bleedIn = 0;
    } else {
      nextConfig.canvas.widthIn = 3.25;
      nextConfig.canvas.heightIn = 5.25;
      nextConfig.canvas.bleedIn = 0.125;
    }
    if (delegateOverlay.length > 0) {
      nextConfig.roles.delegate.frontOverlayUrl = delegateOverlay;
    }
    if (exhibitorOverlay.length > 0) {
      nextConfig.roles.exhibitor.frontOverlayUrl = exhibitorOverlay;
    }
    if (frontTheme === "solid_tint") {
      nextConfig.roles.delegate.mapTintOpacity = 0.32;
      nextConfig.roles.exhibitor.mapTintOpacity = 0.34;
    } else {
      nextConfig.roles.delegate.mapTintOpacity = 0.14;
      nextConfig.roles.exhibitor.mapTintOpacity = 0.16;
    }
    if (qrMode === "profile_link") {
      nextConfig.back.qr.size = Math.max(140, nextConfig.back.qr.size);
    } else {
      nextConfig.back.qr.size = 130;
    }

    await saveBadgeTemplateConfig({
      conferenceId,
      configVersion: nextVersion,
      name: `Setup Draft v${nextVersion} (${reprintPipeline === "printer_bridge" ? "bridge" : "pdf"})`,
      status: "draft",
      fieldMapping: nextConfig,
    });
    await saveBadgeSetupSession({
      conferenceId,
      state: {
        startFrom: startFrom === "current" ? "current" : "blank",
        canvasPreset: preset === "trimmed" ? "trimmed" : "oversized",
        delegateOverlay,
        exhibitorOverlay,
        qrMode: qrMode === "profile_link" ? "profile_link" : "person_uuid",
        frontTheme: frontTheme === "solid_tint" ? "solid_tint" : "map_tint",
        reprintPipeline: reprintPipeline === "printer_bridge" ? "printer_bridge" : "pdf",
      },
      lastStep: Number.isFinite(lastStepRaw) ? lastStepRaw : 3,
      status: "ready",
    });

    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

  async function saveSetupProgressAction(formData: FormData) {
    "use server";
    const startFrom = String(formData.get("start_from") ?? "blank").trim();
    const preset = String(formData.get("canvas_preset") ?? "oversized").trim();
    const delegateOverlay = String(formData.get("delegate_overlay") ?? "").trim();
    const exhibitorOverlay = String(formData.get("exhibitor_overlay") ?? "").trim();
    const frontTheme = String(formData.get("front_theme") ?? "map_tint").trim();
    const qrMode = String(formData.get("qr_mode") ?? "person_uuid").trim();
    const reprintPipeline = String(formData.get("reprint_pipeline") ?? "pdf").trim();
    const lastStepRaw = Number(String(formData.get("setup_last_step") ?? "1"));

    await saveBadgeSetupSession({
      conferenceId,
      state: {
        startFrom: startFrom === "current" ? "current" : "blank",
        canvasPreset: preset === "trimmed" ? "trimmed" : "oversized",
        delegateOverlay,
        exhibitorOverlay,
        qrMode: qrMode === "profile_link" ? "profile_link" : "person_uuid",
        frontTheme: frontTheme === "solid_tint" ? "solid_tint" : "map_tint",
        reprintPipeline: reprintPipeline === "printer_bridge" ? "printer_bridge" : "pdf",
      },
      lastStep: Number.isFinite(lastStepRaw) ? lastStepRaw : 1,
      status: "draft",
    });

    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

  async function resetStartOverAction() {
    "use server";
    const db = createAdminClient();
    const { data: latestRows } = await db
      .from("badge_template_configs")
      .select("config_version")
      .eq("conference_id", conferenceId)
      .order("config_version", { ascending: false })
      .limit(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestVersion = Number((latestRows as any)?.[0]?.config_version ?? 0);
    const nextVersion = Number.isFinite(latestVersion) ? latestVersion + 1 : 1;

    await saveBadgeTemplateConfig({
      conferenceId,
      configVersion: nextVersion,
      name: `Reset Draft v${nextVersion}`,
      status: "draft",
      fieldMapping: normalizeBadgeTemplateConfig(DEFAULT_BADGE_TEMPLATE_CONFIG_V1),
    });

    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

  async function preprintedJobAction(formData: FormData) {
    "use server";
    const templateVersionRaw = String(formData.get("template_version") ?? "").trim();
    const templateVersion =
      templateVersionRaw.length > 0 && Number.isFinite(Number(templateVersionRaw))
        ? Number(templateVersionRaw)
        : null;
    const delegateOrderMode = parseDelegateBatchOrderMode(
      String(formData.get("delegate_order_mode") ?? "delegate_last_name")
    );
    const delegateOrderDirection = String(formData.get("delegate_order_direction") ?? "asc");
    const exhibitorOrderMode = parseExhibitorBatchOrderMode(
      String(formData.get("exhibitor_order_mode") ?? "exhibitor_org_name")
    );
    const exhibitorOrderDirection = String(formData.get("exhibitor_order_direction") ?? "asc");
    const result = await createPreprintedBadgeJob({
      conferenceId,
      templateVersion,
      delegateOrderMode,
      delegateOrderDirection: delegateOrderDirection === "desc" ? "desc" : "asc",
      exhibitorOrderMode,
      exhibitorOrderDirection: exhibitorOrderDirection === "desc" ? "desc" : "asc",
    });
    if (!result.success) {
      redirect(
        `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=error&action_message=${encodeURIComponent(
          result.error ??
            "Failed to create preprinted badge job. Open Setup or Studio and set both front overlays."
        )}`
      );
    }
    const warningCount = result.data?.warningCount ?? 0;
    const warningSuffix =
      warningCount > 0
        ? ` Preflight flagged ${warningCount} text-fit warning(s). Open job events/Studio to fix before final print.`
        : "";
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
    redirect(
      `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=success&action_message=${encodeURIComponent(
        `Print package queued and artifact generated.${warningSuffix}`
      )}`
    );
  }

  async function advanceJobAction(formData: FormData) {
    "use server";
    const jobId = String(formData.get("job_id") ?? "").trim();
    const nextStatus = String(formData.get("next_status") ?? "").trim();
    if (!jobId || !nextStatus) return;
    await advanceBadgePrintJob({
      jobId,
      nextStatus: nextStatus as
        | "queued"
        | "rendering"
        | "rendered"
        | "pdf_generated"
        | "sent_to_printer"
        | "printed"
        | "failed"
        | "canceled"
        | "delivered",
    });
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

  async function deleteJobAction(formData: FormData) {
    "use server";
    const jobId = String(formData.get("job_id") ?? "").trim();
    const reason = String(formData.get("delete_reason") ?? "").trim();
    if (!jobId) return;
    await deleteBadgePrintJob({
      conferenceId,
      jobId,
      reason,
    });
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase infers `never` for wide selects
  const people = (peopleRows ?? []) as Record<string, any>[];
  const registrationIds = Array.from(
    new Set(
      people
        .map((row) => (row.registration_id as string | null) ?? null)
        .filter((value): value is string => Boolean(value))
    )
  );
  const organizationIds = Array.from(
    new Set(
      people
        .map((row) => (row.organization_id as string | null) ?? null)
        .filter((value): value is string => Boolean(value))
    )
  );

  const [{ data: registrationRows }, { data: organizationRows }] = await Promise.all([
    registrationIds.length
      ? adminClient
          .from("conference_registrations")
          .select("id, delegate_email")
          .in("id", registrationIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    organizationIds.length
      ? adminClient
          .from("organizations")
          .select("id, email")
          .in("id", organizationIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const registrationEmailById = new Map<string, string>();
  for (const row of registrationRows ?? []) {
    const id = row.id as string | null;
    const email = row.delegate_email as string | null;
    if (id && email && email.trim().length > 0) {
      registrationEmailById.set(id, email.trim().toLowerCase());
    }
  }

  const organizationEmailById = new Map<string, string>();
  for (const row of organizationRows ?? []) {
    const id = row.id as string | null;
    const email = row.email as string | null;
    if (id && email && email.trim().length > 0) {
      organizationEmailById.set(id, email.trim().toLowerCase());
    }
  }
  const canonicalIds = Array.from(
    new Set(
      people
        .map((row) => (row.canonical_person_id as string | null) ?? null)
        .filter((value): value is string => Boolean(value))
    )
  );
  const canonicalById = new Map<
    string,
    { firstName: string | null; lastName: string | null; email: string | null; title: string | null }
  >();
  if (canonicalIds.length > 0) {
    const { data: canonicalRows } = await adminClient
      .from("people")
      .select("id, first_name, last_name, primary_email, title")
      .in("id", canonicalIds);
    for (const row of (canonicalRows ?? []) as Array<Record<string, unknown>>) {
      const id = row.id as string | null;
      if (!id) continue;
      canonicalById.set(id, {
        firstName: (row.first_name as string | null) ?? null,
        lastName: (row.last_name as string | null) ?? null,
        email: (row.primary_email as string | null) ?? null,
        title: (row.title as string | null) ?? null,
      });
    }
  }
  const missingCanonicalCount = people.filter(
    (row) =>
      !(
        typeof row.canonical_person_id === "string" &&
        row.canonical_person_id.trim().length > 0
      )
  ).length;
  const missingCanonicalPeople = people
    .filter(
      (row) =>
        !(
          typeof row.canonical_person_id === "string" &&
          row.canonical_person_id.trim().length > 0
        )
    )
    .map((row) => ({
      id: String(row.id ?? ""),
      displayName: String(
        ((row.display_name as string | null) ?? "").trim() ||
          ((row.contact_email as string | null) ?? "").trim() ||
          "Unknown"
      ),
      contactEmail: ((row.contact_email as string | null) ?? null)?.trim() || null,
      personKind: ((row.person_kind as string | null) ?? "unknown").trim() || "unknown",
    }))
    .filter((row) => row.id.length > 0);
  const canonicalLookupOptions = ((canonicalLookupRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const id = typeof row.id === "string" ? row.id : "";
      const firstName = typeof row.first_name === "string" ? row.first_name.trim() : "";
      const lastName = typeof row.last_name === "string" ? row.last_name.trim() : "";
      const email =
        typeof row.primary_email === "string" ? row.primary_email.trim().toLowerCase() : "";
      const displayName = `${firstName} ${lastName}`.trim() || "Unknown";
      const label = [displayName, email, id].filter(Boolean).join(" | ");
      return { id, label };
    })
    .filter((row) => row.id.length > 0);

  async function syncPeopleIndexAction() {
    "use server";
    const result = await syncConferencePeopleIndex(conferenceId);
    if (!result.success) {
      redirect(
        `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=error&action_message=${encodeURIComponent(
          result.error ?? "Failed to sync conference people index."
        )}`
      );
    }
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
    revalidatePath(`/admin/conference/${conferenceId}/war-room`);
    redirect(
      `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=success&action_message=${encodeURIComponent(
        "People index sync completed."
      )}`
    );
  }

  async function resolveCanonicalLinkAction(formData: FormData) {
    "use server";
    const personId = String(formData.get("person_id") ?? "").trim();
    if (!personId) return;
    const result = await resolveConferencePersonCanonicalLink(personId);
    if (!result.success) {
      redirect(
        `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=error&action_message=${encodeURIComponent(
          result.error ?? "Failed to resolve canonical person link."
        )}`
      );
    }
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
    revalidatePath(`/admin/conference/${conferenceId}/war-room`);
    redirect(
      `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=success&action_message=${encodeURIComponent(
        "Canonical link updated."
      )}`
    );
  }

  async function setCanonicalLinkManualAction(formData: FormData) {
    "use server";
    const personId = String(formData.get("person_id") ?? "").trim();
    const lookupRaw = String(formData.get("canonical_person_lookup") ?? "").trim();
    if (!personId || !lookupRaw) return;
    const uuidMatch = lookupRaw.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    const lookupLower = lookupRaw.toLowerCase();
    const matchedOption = canonicalLookupOptions.find(
      (option) => option.label.toLowerCase() === lookupLower
    );
    const pipeTokenUuid = lookupRaw
      .split("|")
      .map((token) => token.trim())
      .find((token) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          token
        )
      );
    const canonicalPersonId =
      uuidMatch?.[0]?.toLowerCase() ??
      (pipeTokenUuid ? pipeTokenUuid.toLowerCase() : null) ??
      matchedOption?.id ??
      "";
    if (!canonicalPersonId) {
      redirect(
        `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=error&action_message=${encodeURIComponent(
          "Pick a valid canonical person from the lookup list."
        )}`
      );
    }
    const result = await setConferencePersonCanonicalLink({
      personId,
      canonicalPersonId,
    });
    if (!result.success) {
      redirect(
        `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=error&action_message=${encodeURIComponent(
          result.error ?? "Failed to set canonical person link."
        )}`
      );
    }
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
    revalidatePath(`/admin/conference/${conferenceId}/war-room`);
    redirect(
      `/admin/conference/${conferenceId}/badges?mode=${mode}&action_status=success&action_message=${encodeURIComponent(
        "Manual canonical link saved."
      )}`
    );
  }

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Badge Operations</h1>
          <p className="mt-1 text-sm text-gray-600">
            {conf.name} ({conf.year}-{conf.edition_code})
          </p>
        </div>
        <Link
          href={`/admin/conference/${conferenceId}`}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to Conference
        </Link>
      </div>

      {actionStatus && actionMessage ? (
        <section
          className={`rounded-xl border p-3 text-sm ${
            actionStatus === "success"
              ? "border-green-300 bg-green-50 text-green-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {actionMessage}
        </section>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Badge Workflow</h2>
        <p className="mt-1 text-sm text-gray-600">
          Move between setup, reset, studio work, and badge operations without losing progress.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=setup`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "setup"
                ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Setup
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=reset`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "reset"
                ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Reset / Start Over
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=studio`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "studio"
                ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Working Studio
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=make`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "make"
                ? "border-[#EE2A2E] bg-red-50 text-[#EE2A2E]"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Make Badges
          </Link>
        </div>
      </section>

      {mode === "setup" ? (
        <BadgeSetupWizardStub
          conferenceId={conferenceId}
          initialState={setupSession?.state ?? null}
          initialStep={setupSession?.lastStep ?? null}
          saveDraftAction={setupCreateDraftAction}
          saveProgressAction={saveSetupProgressAction}
        />
      ) : null}

      {mode === "reset" ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-base font-semibold text-amber-900">Reset / Start Over</h2>
          <p className="mt-1 text-sm text-amber-900">
            Create a fresh draft from defaults without deleting prior versions.
          </p>
          <form action={resetStartOverAction} className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
            >
              Create Fresh Draft
            </button>
            <Link
              href={`/admin/conference/${conferenceId}/badges?mode=setup`}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Go to Setup Wizard
            </Link>
            <Link
              href={`/admin/conference/${conferenceId}/badges?mode=studio`}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Return to Working Studio
            </Link>
          </form>
        </section>
      ) : null}

      {mode === "make" ? (
        <BadgeQuickReprint
          conferenceId={conferenceId}
          people={people.map((row) => ({
            id: row.id as string,
            displayName:
              ((row.canonical_person_id as string | null)
                ? (() => {
                    const canonical = canonicalById.get(row.canonical_person_id as string);
                    if (!canonical) return null;
                    return `${canonical.firstName ?? ""} ${canonical.lastName ?? ""}`.trim() || null;
                  })()
                : null) ??
              ((row.display_name as string | null) ?? null),
            contactEmail:
              ((row.canonical_person_id as string | null)
                ? (canonicalById.get(row.canonical_person_id as string)?.email ?? null)
                : null) ||
              ((row.contact_email as string | null) ?? null) ||
              ((row.assigned_email_snapshot as string | null) ?? null) ||
              ((row.registration_id as string | null)
                ? (registrationEmailById.get(row.registration_id as string) ?? null)
                : null) ||
              ((row.organization_id as string | null)
                ? (organizationEmailById.get(row.organization_id as string) ?? null)
                : null),
            roleTitle:
              ((row.canonical_person_id as string | null)
                ? (canonicalById.get(row.canonical_person_id as string)?.title ?? null)
                : null) ?? ((row.role_title as string | null) ?? null),
            personKind: (row.person_kind as string) ?? "unknown",
          }))}
        />
      ) : null}

      {(mode === "studio" || mode === "make") && missingCanonicalCount > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            Badge preflight blocked: {missingCanonicalCount} conference people are missing
            canonical person linkage.
          </p>
          <p className="mt-1">
            Fix these rows, then regenerate the print package.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canRunCanonicalFixes ? (
              <form action={syncPeopleIndexAction}>
                <button
                  type="submit"
                  className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  Sync People Index
                </button>
              </form>
            ) : null}
            <Link
              href={`/admin/conference/${conferenceId}/war-room`}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Open People Lookup
            </Link>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-amber-200 bg-white">
            <table className="min-w-full divide-y divide-amber-100 text-xs">
              <thead className="bg-amber-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-amber-900">Person</th>
                  <th className="px-3 py-2 text-left font-semibold text-amber-900">Email</th>
                  <th className="px-3 py-2 text-left font-semibold text-amber-900">Kind</th>
                  <th className="px-3 py-2 text-left font-semibold text-amber-900">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {missingCanonicalPeople.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-amber-950">{row.displayName}</td>
                    <td className="px-3 py-2 text-amber-900">{row.contactEmail ?? "—"}</td>
                    <td className="px-3 py-2 text-amber-900">{row.personKind}</td>
                    <td className="px-3 py-2">
                      {canRunCanonicalFixes ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={resolveCanonicalLinkAction}>
                            <input type="hidden" name="person_id" value={row.id} />
                            <button
                              type="submit"
                              className="rounded border border-amber-400 px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
                            >
                              Attempt Auto Link
                            </button>
                          </form>
                          <form action={setCanonicalLinkManualAction} className="flex items-center gap-2">
                            <input type="hidden" name="person_id" value={row.id} />
                            <input
                              name="canonical_person_lookup"
                              list="canonical-people-options"
                              placeholder="Type name/email/canonical ID"
                              className="w-64 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-950"
                              required
                            />
                            <button
                              type="submit"
                              className="rounded border border-amber-400 px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
                            >
                              Link Selected ID
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-amber-900">Admin required</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="canonical-people-options">
              {canonicalLookupOptions.map((option) => (
                <option key={option.id} value={option.label} />
              ))}
            </datalist>
          </div>
        </section>
      ) : null}

      {(mode === "studio" || mode === "make") ? (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Print Package (Pre-Event)</h2>
        <p className="mt-1 text-sm text-gray-600">
          Generate a PDF package for pre-printing badges in deterministic order.
        </p>
        <div className="mt-2 text-sm text-gray-700">
          Template: <span className="font-medium">v{String((selectedConfigRow?.config_version as number | undefined) ?? "—")}</span>{" "}
          ({String((selectedConfigRow?.name as string | undefined) ?? "Unnamed")} /{" "}
          {String((selectedConfigRow?.status as string | undefined) ?? "draft")})
          <span className="mx-2 text-gray-400">•</span>
          People in package: <span className="font-medium">{delegateCount + exhibitorCount}</span>{" "}
          (<span className="font-medium">{delegateCount}</span> delegates,{" "}
          <span className="font-medium">{exhibitorCount}</span> exhibitors)
        </div>
        <form action={preprintedJobAction} className="mt-3 space-y-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                1. Template
              </p>
              <label className="mt-2 block text-sm text-gray-700">
                Template version
                <select
                  name="template_version"
                  defaultValue={String((selectedConfigRow?.config_version as number | undefined) ?? "")}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                >
                  {configs.map((row) => (
                    <option key={String(row.id)} value={String(row.config_version)}>
                      v{String(row.config_version)} - {String(row.name ?? "Unnamed")} [{String(row.status)}]
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                2. Delegates
              </p>
              <label className="mt-2 block text-sm text-gray-700">
                Sort delegates by
                <select
                  name="delegate_order_mode"
                  defaultValue="delegate_last_name"
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                >
                  {DELEGATE_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-sm text-gray-700">
                Delegate direction
                <select
                  name="delegate_order_direction"
                  defaultValue="asc"
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                >
                  <option value="asc">A to Z / Low to High</option>
                  <option value="desc">Z to A / High to Low</option>
                </select>
              </label>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                3. Exhibitors
              </p>
              <label className="mt-2 block text-sm text-gray-700">
                Sort exhibitors by
                <select
                  name="exhibitor_order_mode"
                  defaultValue="exhibitor_org_name"
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                >
                  {EXHIBITOR_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-sm text-gray-700">
                Exhibitor direction
                <select
                  name="exhibitor_order_direction"
                  defaultValue="asc"
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                >
                  <option value="asc">A to Z / Low to High</option>
                  <option value="desc">Z to A / High to Low</option>
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              4. Generate
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={missingCanonicalCount > 0}
                className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Print Package (PDF)
              </button>
              <span className="text-xs text-gray-500">
                Front + back badges, grouped by role with independent sort rules.
              </span>
            </div>
          </div>
        </form>
      </section>
      ) : null}

      {mode === "studio" && configs.length > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Working Template</h2>
          <p className="mt-1 text-sm text-gray-600">
            Studio defaults to latest draft so you can work from a blank slate without touching the active template.
          </p>
          <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="mode" value="studio" />
            <label className="text-sm text-gray-700">
              Template version
              <select
                name="template"
                defaultValue={String((selectedConfigRow?.config_version as number | undefined) ?? "")}
                className="mt-1 block rounded-md border border-gray-300 px-3 py-2"
              >
                {configs.map((row) => (
                  <option key={String(row.id)} value={String(row.config_version)}>
                    v{String(row.config_version)} - {String(row.name ?? "Unnamed")} [{String(row.status)}]
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Load Template
            </button>
          </form>
        </section>
      ) : null}

      {mode === "studio" ? (
        <BadgeTemplateEditor
          initialConfig={selectedConfig}
          initialVersion={(selectedConfigRow?.config_version as number | undefined) ?? 1}
          initialName={(selectedConfigRow?.name as string | undefined) ?? "Default Template"}
          initialStatus={
            ((selectedConfigRow?.status as "draft" | "active" | "archived" | undefined) ??
              "draft")
          }
          saveAction={saveTemplateEditorAction}
        />
      ) : null}

      {mode === "make" ? (
      <>
      <BadgeJobsAutoRefresh conferenceId={conferenceId} intervalMs={4000} />
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Jobs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Created</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Pipeline</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Transport</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Reason</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Artifact</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Advance</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-gray-500" colSpan={8}>
                    No badge jobs yet.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={String(job.id)}>
                    <td className="px-3 py-2 text-gray-700">{String(job.created_at)}</td>
                    <td className="px-3 py-2 text-gray-700">{String(job.pipeline_type)}</td>
                    <td className="px-3 py-2 text-gray-700">{String(job.status)}</td>
                    <td className="px-3 py-2 text-gray-700">{String(job.transport_method)}</td>
                    <td className="px-3 py-2 text-gray-700">{String(job.reprint_reason ?? "—")}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {job.output_artifact_url ? (
                        <Link
                          href={String(job.output_artifact_url)}
                          target="_blank"
                          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <form action={advanceJobAction} className="flex items-center gap-2">
                        <input type="hidden" name="job_id" value={String(job.id)} />
                        <select
                          name="next_status"
                          defaultValue="rendering"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="rendering">rendering</option>
                          <option value="rendered">rendered</option>
                          <option value="pdf_generated">pdf_generated</option>
                          <option value="sent_to_printer">sent_to_printer</option>
                          <option value="printed">printed</option>
                          <option value="delivered">delivered</option>
                          <option value="failed">failed</option>
                          <option value="canceled">canceled</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Apply
                        </button>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <form action={deleteJobAction} className="flex flex-col gap-2">
                        <input type="hidden" name="job_id" value={String(job.id)} />
                        <input
                          name="delete_reason"
                          type="text"
                          required
                          minLength={8}
                          placeholder="Reason for deletion"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete Job
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : null}
    </main>
  );
}
