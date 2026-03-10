import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePolicySet, getEffectivePolicy } from "@/lib/policy/engine";
import { logAuditEventSafe } from "@/lib/ops/audit";

const TRAVEL_FIELDS_TO_PURGE = [
  "legal_name",
  "date_of_birth",
  "preferred_departure_airport",
  "road_origin_address",
  "nexus_trusted_traveler",
  "seat_preference",
  "emergency_contact_name",
  "emergency_contact_phone",
  "gender",
  "mobile_phone",
] as const;

type RetentionConference = {
  id: string;
  year: number;
  name: string;
  edition_code: string;
};

type PurgeRpcRow = {
  records_purged: number;
  retention_job_id: string;
};

export type RetentionPurgeConferenceResult = {
  conferenceId: string;
  conferenceName: string;
  editionCode: string;
  year: number;
  cutoffAt: string;
  status: "completed" | "failed";
  recordsPurged: number;
  retentionJobId?: string;
  error?: string;
};

export type RetentionPurgeJobResult = {
  success: boolean;
  policySetId: string | null;
  rule: string;
  ranAt: string;
  conferencesEvaluated: number;
  conferencesDue: number;
  completed: number;
  failed: number;
  recordsPurged: number;
  results: RetentionPurgeConferenceResult[];
  error?: string;
};

function conferenceCutoffIso(year: number): string {
  return new Date(Date.UTC(year, 2, 1, 0, 0, 0, 0)).toISOString();
}

export async function retentionPurgeRun(): Promise<RetentionPurgeJobResult> {
  const now = new Date();
  const ranAt = now.toISOString();
  const db = createAdminClient();
  const untypedDb = db as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
    from: (table: string) => {
      insert: (values: Record<string, unknown>) => {
        select: (columns: string) => {
          maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
    };
  };

  let rule: string;
  try {
    rule = await getEffectivePolicy<string>("retention.travel_delete_rule");
  } catch (error) {
    return {
      success: false,
      policySetId: null,
      rule: "unresolved",
      ranAt,
      conferencesEvaluated: 0,
      conferencesDue: 0,
      completed: 0,
      failed: 0,
      recordsPurged: 0,
      results: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to resolve retention.travel_delete_rule",
    };
  }

  if (rule !== "march_1_conference_year_utc") {
    return {
      success: false,
      policySetId: null,
      rule,
      ranAt,
      conferencesEvaluated: 0,
      conferencesDue: 0,
      completed: 0,
      failed: 0,
      recordsPurged: 0,
      results: [],
      error: `Unsupported retention travel delete rule: ${rule}`,
    };
  }

  const activePolicySet = await getActivePolicySet();
  const policySetId = activePolicySet?.id ?? null;

  const { data: conferences, error: conferencesError } = await db
    .from("conference_instances")
    .select("id, year, name, edition_code")
    .order("year", { ascending: false });

  if (conferencesError) {
    return {
      success: false,
      policySetId,
      rule,
      ranAt,
      conferencesEvaluated: 0,
      conferencesDue: 0,
      completed: 0,
      failed: 0,
      recordsPurged: 0,
      results: [],
      error: conferencesError.message,
    };
  }

  const conferenceRows = (conferences ?? []) as RetentionConference[];
  const dueConferences = conferenceRows.filter((conference) => {
    const cutoffAt = conferenceCutoffIso(conference.year);
    return cutoffAt <= ranAt;
  });

  const results: RetentionPurgeConferenceResult[] = [];
  let completed = 0;
  let failed = 0;
  let totalPurged = 0;

  for (const conference of dueConferences) {
    const cutoffAt = conferenceCutoffIso(conference.year);
    try {
      const { data: rpcData, error: rpcError } = await untypedDb.rpc(
        "run_travel_retention_purge",
        {
          p_conference_id: conference.id,
          p_policy_set_id: policySetId,
          p_cutoff_at: cutoffAt,
          p_fields: [...TRAVEL_FIELDS_TO_PURGE],
        }
      );

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const row = ((rpcData ?? [])[0] ?? null) as PurgeRpcRow | null;
      const recordsPurged = row?.records_purged ?? 0;
      totalPurged += recordsPurged;
      completed += 1;

      const result: RetentionPurgeConferenceResult = {
        conferenceId: conference.id,
        conferenceName: conference.name,
        editionCode: conference.edition_code,
        year: conference.year,
        cutoffAt,
        status: "completed",
        recordsPurged,
        retentionJobId: row?.retention_job_id,
      };
      results.push(result);

      await logAuditEventSafe({
        action: "retention_conference_purge_completed",
        entityType: "conference_instance",
        entityId: conference.id,
        actorType: "cron",
        details: {
          conferenceId: conference.id,
          conferenceName: conference.name,
          editionCode: conference.edition_code,
          year: conference.year,
          cutoffAt,
          recordsPurged,
          retentionJobId: row?.retention_job_id ?? null,
          policySetId,
          fieldsPurged: [...TRAVEL_FIELDS_TO_PURGE],
          retentionRule: rule,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown retention purge error";

      const { data: failedRow } = await untypedDb
        .from("retention_jobs")
        .insert({
          job_type: "travel_purge",
          conference_id: conference.id,
          policy_set_id: policySetId,
          cutoff_at: cutoffAt,
          records_purged: 0,
          fields_purged: [...TRAVEL_FIELDS_TO_PURGE],
          status: "failed",
          error_details: errorMessage,
        })
        .select("id")
        .maybeSingle();

      failed += 1;
      results.push({
        conferenceId: conference.id,
        conferenceName: conference.name,
        editionCode: conference.edition_code,
        year: conference.year,
        cutoffAt,
        status: "failed",
        recordsPurged: 0,
        retentionJobId: failedRow?.id,
        error: errorMessage,
      });

      await logAuditEventSafe({
        action: "retention_conference_purge_failed",
        entityType: "conference_instance",
        entityId: conference.id,
        actorType: "cron",
        details: {
          conferenceId: conference.id,
          conferenceName: conference.name,
          editionCode: conference.edition_code,
          year: conference.year,
          cutoffAt,
          error: errorMessage,
          policySetId,
          fieldsPurged: [...TRAVEL_FIELDS_TO_PURGE],
          retentionRule: rule,
        },
      });
    }
  }

  const summary: RetentionPurgeJobResult = {
    success: failed === 0,
    policySetId,
    rule,
    ranAt,
    conferencesEvaluated: conferenceRows.length,
    conferencesDue: dueConferences.length,
    completed,
    failed,
    recordsPurged: totalPurged,
    results,
  };

  await logAuditEventSafe({
    action: "retention_run_completed",
    entityType: "retention_jobs",
    actorType: "cron",
    details: {
      success: summary.success,
      policySetId: summary.policySetId,
      rule: summary.rule,
      ranAt: summary.ranAt,
      conferencesEvaluated: summary.conferencesEvaluated,
      conferencesDue: summary.conferencesDue,
      completed: summary.completed,
      failed: summary.failed,
      recordsPurged: summary.recordsPurged,
      results: summary.results,
    },
  });

  return summary;
}
