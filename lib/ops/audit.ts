import { createAdminClient } from "@/lib/supabase/admin";

export type AuditActorType = "user" | "system" | "webhook" | "cron";

export type LogAuditEventInput = {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
};

/**
 * Writes a single immutable audit event.
 * Uses the server-side admin client so writes are not blocked by user RLS context.
 */
export async function logAuditEvent({
  action,
  entityType = null,
  entityId = null,
  actorId = null,
  actorType = "user",
  details = {},
  ipAddress = null,
}: LogAuditEventInput): Promise<void> {
  const adminClient = createAdminClient() as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  };

  const { error } = await adminClient.from("audit_log").insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    actor_id: actorId,
    actor_type: actorType,
    details,
    ip_address: ipAddress,
  });

  if (error) {
    throw new Error(`Failed to write audit event: ${error.message}`);
  }
}

export async function logAuditEventSafe(input: LogAuditEventInput): Promise<void> {
  try {
    await logAuditEvent(input);
  } catch (error) {
    console.warn("[audit] Failed to write audit event", {
      action: input.action,
      entityType: input.entityType,
      error,
    });
  }
}
