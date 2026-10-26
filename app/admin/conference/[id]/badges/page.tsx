import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isGlobalAdmin, requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBadgeSetupSession,
  listBadgeTemplateConfigs,
  saveBadgeSetupSession,
  saveBadgeTemplateConfig,
} from "@/lib/actions/conference-badges";
import {
  resolveConferencePersonCanonicalLink,
  setConferencePersonCanonicalLink,
  syncConferencePeopleIndex,
} from "@/lib/actions/conference-people";
import { resolveBadgeRun, namedSeats, unnamedSeats } from "@/lib/conference/badges/run";
import { DEFAULT_VARIANT } from "@/lib/conference/badges/template";
import BadgeArrangementEditor from "@/components/admin/conference/BadgeArrangementEditor";
import BadgeScanRulesEditor from "@/components/admin/conference/BadgeScanRulesEditor";
import BadgePrintStockEditor from "@/components/admin/conference/BadgePrintStockEditor";
import { loadBadgeScanRuleOptions } from "@/lib/actions/badge-scan-rules";
import { loadBadgePrintStockOptions } from "@/lib/actions/badge-print-stock";
import {
  normalizeArrangement,
  type BadgeArrangement,
} from "@/lib/conference/badges/arrangement";
import BadgeTemplateEditor from "@/components/admin/conference/BadgeTemplateEditor";
import BadgeSetupWizardStub from "@/components/admin/conference/BadgeSetupWizardStub";
import {
  DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
  normalizeBadgeTemplateConfig,
} from "@/lib/conference/badges/template";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Badge Ops is Manage: what a badge is. Making and reprinting badges is Operate
 * and lives in the War Room's Print tab (WAR_ROOM_OPERATE_PLAN §6), so the old
 * "Make Badges" mode is gone and its address goes there.
 */
type BadgeOpsMode = "setup" | "reset" | "studio";

function parseBadgeOpsMode(value: string | string[] | undefined): BadgeOpsMode | "make" {
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
  const requestedMode = parseBadgeOpsMode(query.mode);
  if (requestedMode === "make") redirect(`/admin/conference/${conferenceId}/war-room?tab=print`);
  const mode: BadgeOpsMode = requestedMode;
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
    scanRulesResult,
    printStockResult,
    configsResult,
    setupSessionResult,
    peopleResult,
    { data: canonicalLookupRows },
  ] =
    await Promise.all([
      adminClient
        .from("conference_instances")
        .select("id, name, year, edition_code")
        .eq("id", conferenceId)
        .maybeSingle(),
      // Enumerated from live data so an admin assigns what exists rather than
      // typing an organisation type from memory.
      loadBadgeScanRuleOptions(conferenceId),
      // Percentages shown with the counts they resolve to, from the same
      // function the printer uses.
      loadBadgePrintStockOptions(conferenceId),
      listBadgeTemplateConfigs(conferenceId),
      getBadgeSetupSession(conferenceId),
      adminClient
        .from("conference_people")
        .select(
          "id, canonical_person_id, display_name, contact_email, assigned_email_snapshot, role_title, person_kind, organization_id"
        )
        .eq("conference_id", conferenceId)
        .neq("assignment_status", "canceled")
        .order("person_kind", { ascending: true })
        .order("display_name", { ascending: true }),
      adminClient
        .from("contacts")
        .select("id, first_name, last_name, primary_email:work_email")
        .limit(800),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase infers `never` for wide selects
  const conf = conference as Record<string, any> | null;
  if (!conf) {
    return <main className="p-6 text-sm text-red-700">Conference not found.</main>;
  }

  // An unreadable roster must not render as an empty one. Badge Ops showing a
  // clean "0 delegates, 0 exhibitors" while the query was in fact rejected is
  // how the v3 column drift stayed invisible for months.
  if (peopleResult.error) {
    return (
      <main className="p-6 text-sm text-red-700">
        Could not load the conference roster: {peopleResult.error.message}
      </main>
    );
  }
  const peopleRows = peopleResult.data;

  const scanRuleOptions = scanRulesResult.ok ? scanRulesResult.data : null;
  const printStockOptions = printStockResult.ok ? printStockResult.data : null;

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
  // A badge run is grouped by the registration types this conference sells —
  // whatever they are. Nothing here knows the words "delegate" or "exhibitor".
  const badgeRun = await resolveBadgeRun(conferenceId);
  const named = namedSeats(badgeRun);
  // Operator surfaces name the catalogue type someone holds — the thing an admin
  // recognises from the Build tab — rather than an internal person_kind string.
  const variantNameByPersonId = new Map(
    named.map(({ type, seat }) => [seat.person!.personId, type.name] as const)
  );
  const unnamed = unnamedSeats(badgeRun);
  const soldTypes = badgeRun.types.filter((type) => type.seats.length > 0);
  const unallocatedSeatOrgCount = new Set(unnamed.map((s) => s.seat.organizationId)).size;
  // The editor's tabs are this conference's registration types. It stores
  // layouts by entity id; these are the names a human recognises from Catalog.
  const variantLabels = Object.fromEntries(
    badgeRun.types.map((type) => [type.entityId, type.name])
  );

  // How the print file is stacked. Defaults to one section per registration
  // type — a useful stack before anyone expresses a preference, and it makes
  // the grouping control discoverable by showing what a section IS.
  // ⛔ EVERY registration type, not only the ones with seats. Filtering to
  // "types somebody has bought" hid five of this conference's ten types — all
  // four day passes and the book-partner type — so an admin could not arrange
  // what they could not see, and a type added tomorrow would be invisible until
  // its first sale. What is in the catalogue is what you arrange.
  const arrangementTypes = badgeRun.types.map((type) => ({
    entityId: type.entityId,
    name: type.name,
    count: type.seats.filter((seat) => seat.person).length,
  }));
  const currentArrangement = normalizeArrangement(
    setupSession?.state?.arrangement ?? null,
    arrangementTypes
  );

  async function saveArrangementAction(arrangement: BadgeArrangement) {
    "use server";
    await saveBadgeSetupSession({
      conferenceId,
      state: { ...(setupSession?.state ?? {}), arrangement },
      lastStep: setupSession?.lastStep ?? 0,
      status: setupSession?.status ?? "draft",
    });
    revalidatePath(`/admin/conference/${conferenceId}/badges`);
  }

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
      // Every variant, not two named ones — a conference may have any number.
      for (const variant of Object.values(nextConfig.variants)) {
        variant.frontOverlayUrl = null;
        variant.frontBackgroundUrl = null;
      }
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
    // ⚠️ The wizard still offers exactly two overlay fields, which is the same
    // two-design assumption the editor tabs carry. Until that UI is generalised,
    // the first field dresses the default variant every type inherits, and the
    // second dresses any variant that has been differentiated from it.
    const otherVariants = Object.keys(nextConfig.variants).filter((k) => k !== DEFAULT_VARIANT);
    if (delegateOverlay.length > 0) {
      nextConfig.variants[DEFAULT_VARIANT].frontOverlayUrl = delegateOverlay;
    }
    if (exhibitorOverlay.length > 0) {
      for (const key of otherVariants) nextConfig.variants[key].frontOverlayUrl = exhibitorOverlay;
    }
    const [defaultTint, variantTint] = frontTheme === "solid_tint" ? [0.32, 0.34] : [0.14, 0.16];
    nextConfig.variants[DEFAULT_VARIANT].mapTintOpacity = defaultTint;
    for (const key of otherVariants) nextConfig.variants[key].mapTintOpacity = variantTint;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase infers `never` for wide selects
  const people = (peopleRows ?? []) as Record<string, any>[];
  const organizationIds = Array.from(
    new Set(
      people
        .map((row) => (row.organization_id as string | null) ?? null)
        .filter((value): value is string => Boolean(value))
    )
  );

  // `conference_people.registration_id` used to reach delegate_email on the v2
  // registration row. That table is empty and the column is NULL on every v3
  // person, so the hop resolved to nothing on every render. The chain below
  // already prefers three better sources — the linked contact, the person's own
  // contact_email, the invite snapshot — and still falls back to the org.
  const { data: organizationRows } = organizationIds.length
    ? await adminClient.from("organizations").select("id, email").in("id", organizationIds)
    : { data: [] as Record<string, unknown>[] };

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
      .from("contacts")
      .select("id, first_name, last_name, primary_email:work_email, title:role_title")
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
  // ⛔ One answer. This used to test `canonical_person_id` here while
  // resolveBadgeRun tested something else, so the page could block a print run
  // the roster considered fine. `canonical_person_id` also has NO foreign key —
  // on CSC 2027 one row points at a contact that does not exist — so the roster
  // resolves identity from `contact_id` first and this follows it.
  const unlinkedPersonIds = new Set(
    named.filter(({ seat }) => !seat.person!.hasIdentityLink).map(({ seat }) => seat.person!.personId)
  );
  const missingCanonicalCount = unlinkedPersonIds.size;
  const missingCanonicalPeople = people
    .filter((row) => unlinkedPersonIds.has(row.id as string))
    .map((row) => ({
      id: String(row.id ?? ""),
      displayName: String(
        ((row.display_name as string | null) ?? "").trim() ||
          ((row.contact_email as string | null) ?? "").trim() ||
          "Unknown"
      ),
      contactEmail: ((row.contact_email as string | null) ?? null)?.trim() || null,
      registrationType: variantNameByPersonId.get(row.id as string) ?? "No registration seat",
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
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=setup`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "setup"
                ? "border-accent bg-red-50 text-accent"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Setup
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=reset`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "reset"
                ? "border-accent bg-red-50 text-accent"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Reset / Start Over
          </Link>
          <Link
            href={`/admin/conference/${conferenceId}/badges?mode=studio`}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${
              mode === "studio"
                ? "border-accent bg-red-50 text-accent"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Working Studio
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
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
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

      {mode === "studio" && missingCanonicalCount > 0 ? (
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
                  <th className="px-3 py-2 text-left font-semibold text-amber-900">Registration type</th>
                  <th className="px-3 py-2 text-left font-semibold text-amber-900">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {missingCanonicalPeople.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-amber-950">{row.displayName}</td>
                    <td className="px-3 py-2 text-amber-900">{row.contactEmail ?? "—"}</td>
                    <td className="px-3 py-2 text-amber-900">{row.registrationType}</td>
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
          variantLabels={variantLabels}
        />
      ) : null}

      {/* Print package sits BELOW the editor on purpose: arranging the file
          is a preflight step for generation, so it comes after you have
          decided what a badge looks like, not before. Design → arrange →
          generate. */}
      {mode === "studio" ? (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Print package: rules, stock and order</h2>
        <p className="mt-1 text-sm text-gray-600">
          What the pre-printed package says, what blank stock comes with it, and how the file is stacked.
        </p>
        <div className="mt-2 text-sm text-gray-700">
          Badges to print: <span className="font-medium">{named.length}</span>
          {soldTypes.length > 0 ? (
            <span className="ml-1 text-gray-500">
              (
              {soldTypes
                .map((type) => `${type.seats.filter((s) => s.person).length}/${type.seats.length} ${type.name}`)
                .join(" · ")}
              )
            </span>
          ) : null}
          {unnamed.length > 0 ? (
            <>
              {" · "}
              <span className="font-medium">{unnamed.length}</span> seat
              {unnamed.length === 1 ? "" : "s"} across{" "}
              <span className="font-medium">{unallocatedSeatOrgCount}</span> organisation
              {unallocatedSeatOrgCount === 1 ? "" : "s"} have nobody named to them
            </>
          ) : null}
        </div>
        <div className="mt-3 space-y-3">

          {/* Rules come first because they change what the badge SAYS — which
              days appear on the schedule — and what a scan of it does. Arranging
              and generating are print-file steps downstream of that. */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              1. Rules
            </p>
            <div className="mt-2">
              {scanRuleOptions ? (
                <BadgeScanRulesEditor
                  conferenceId={conferenceId}
                  options={scanRuleOptions}
                />
              ) : (
                <p className="text-xs text-gray-500">
                  Could not load the organisation types and days for this conference.
                </p>
              )}
            </div>
          </div>

          {/* Stock sits with the rules, not with Generate: it is a policy the
              conference decides once, and the job snapshots it. Putting it on
              the Generate button would invite changing it per run, which is how
              two jobs from the same roster come back different lengths. */}
          {printStockOptions ? (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                1b. Blank stock
              </p>
              <div className="mt-2">
                <BadgePrintStockEditor
                  conferenceId={conferenceId}
                  options={printStockOptions}
                />
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              2. Arrange the file
            </p>
            <div className="mt-2">
              <BadgeArrangementEditor
                types={arrangementTypes}
                initial={currentArrangement}
                saveAction={saveArrangementAction}
              />
            </div>
          </div>

          {/* Making the package is Operate: it happens in the War Room's Print
              tab, which reads this arrangement, these rules and this stock
              (WAR_ROOM_OPERATE_PLAN §6). Badge Ops says what a badge is. */}
          <p className="text-sm text-gray-600">
            Ready to print? Make the package in the{" "}
            <Link href={`/admin/conference/${conferenceId}/war-room?tab=print`} className="font-medium text-accent hover:underline">
              War Room&apos;s Print tab
            </Link>
            .
          </p>
        </div>
      </section>
      ) : null}
    </main>
  );
}
