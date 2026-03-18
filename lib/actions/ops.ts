"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { evaluateOpsAlerts } from "@/lib/ops/alerts";
import {
  graceStateTransitionRun,
  renewalChargeRun,
  renewalReminderRun,
} from "@/lib/renewal/jobs";
import { processCircleSyncQueue } from "@/lib/circle/sync";
import { retentionPurgeRun } from "@/lib/retention/jobs";
import { quickbooksExportRun } from "@/lib/quickbooks/export";
import { quickbooksInboundReconcileRun } from "@/lib/quickbooks/reconcile";
import { stripe } from "@/lib/stripe/client";
import {
  extractConferenceOrderIdFromStripeEvent,
  isHandledStripeWebhookEvent,
  processStripeWebhookEvent,
  recordConferenceWebhookEvent,
  toWebhookPayloadJson,
} from "@/lib/stripe/webhook-processing";


export async function acknowledgeOpsAlertAction(alertId: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("ops_alerts")
    .update({
      status: "acknowledged",
      is_acknowledged: true,
      acknowledged_by: auth.ctx.userId,
      acknowledged_at: now,
      owner_id: auth.ctx.userId,
    })
    .eq("id", alertId);

  if (error) {
    return { success: false, error: `Failed to acknowledge alert: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "ops_alert_acknowledged",
    entityType: "ops_alert",
    entityId: alertId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { alertId },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function resolveOpsAlertAction(alertId: string): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await adminClient
    .from("ops_alerts")
    .update({
      status: "resolved",
      resolved_by: auth.ctx.userId,
      resolved_at: now,
      is_acknowledged: true,
      acknowledged_by: auth.ctx.userId,
      acknowledged_at: now,
      owner_id: auth.ctx.userId,
    })
    .eq("id", alertId);

  if (error) {
    return { success: false, error: `Failed to resolve alert: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "ops_alert_resolved",
    entityType: "ops_alert",
    entityId: alertId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { alertId },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function setOpsAlertTriageAction(
  alertId: string,
  dueAt: string | null
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const normalizedDueAt =
    dueAt && dueAt.trim().length > 0 ? new Date(dueAt).toISOString() : null;

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("ops_alerts")
    .update({
      owner_id: auth.ctx.userId,
      due_at: normalizedDueAt,
    })
    .eq("id", alertId);

  if (error) {
    return { success: false, error: `Failed to update alert triage: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "ops_alert_triage_updated",
    entityType: "ops_alert",
    entityId: alertId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { alertId, dueAt: normalizedDueAt },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function runOpsAlertEvaluationAction(): Promise<{
  success: boolean;
  createdCount?: number;
  resolvedCount?: number;
  activeRuleKeys?: string[];
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const result = await evaluateOpsAlerts();
  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to evaluate ops alerts" };
  }

  await logAuditEventSafe({
    action: "ops_alert_evaluation_run",
    entityType: "ops_alert",
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      createdCount: result.createdCount,
      resolvedCount: result.resolvedCount,
      activeRuleKeys: result.activeRuleKeys,
    },
  });

  revalidatePath("/admin/ops");
  return {
    success: true,
    createdCount: result.createdCount,
    resolvedCount: result.resolvedCount,
    activeRuleKeys: result.activeRuleKeys,
  };
}

export type OpsManualJobKey =
  | "renewal_reminders"
  | "renewal_charge"
  | "grace_check"
  | "circle_sync"
  | "ops_alert_eval"
  | "retention_purge"
  | "qbo_export"
  | "qbo_reconcile";

export async function runOpsJobNowAction(
  job: OpsManualJobKey,
  reason: string
): Promise<{ success: boolean; error?: string; result?: Record<string, unknown> }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  try {
    let result: Record<string, unknown> = {};
    if (job === "renewal_reminders") {
      result = (await renewalReminderRun()) as unknown as Record<string, unknown>;
    } else if (job === "renewal_charge") {
      result = (await renewalChargeRun()) as unknown as Record<string, unknown>;
    } else if (job === "grace_check") {
      result = (await graceStateTransitionRun()) as unknown as Record<string, unknown>;
    } else if (job === "circle_sync") {
      result = (await processCircleSyncQueue()) as unknown as Record<string, unknown>;
    } else if (job === "retention_purge") {
      result = (await retentionPurgeRun()) as unknown as Record<string, unknown>;
    } else if (job === "qbo_export") {
      result = (await quickbooksExportRun()) as unknown as Record<string, unknown>;
    } else if (job === "qbo_reconcile") {
      result = (await quickbooksInboundReconcileRun()) as unknown as Record<string, unknown>;
    } else {
      result = (await evaluateOpsAlerts()) as unknown as Record<string, unknown>;
    }

    const resultSuccessField = result.success;
    const interpretedSuccess =
      typeof resultSuccessField === "boolean" ? resultSuccessField : true;

    if (!interpretedSuccess) {
      const resultError = typeof result.error === "string" ? result.error : "Manual run failed";
      await logAuditEventSafe({
        action: "ops_job_manual_run",
        entityType: "ops_job",
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          job,
          reason: trimmedReason,
          success: false,
          error: resultError,
          result,
        },
      });
      return {
        success: false,
        error: resultError,
        result,
      };
    }

    await logAuditEventSafe({
      action: "ops_job_manual_run",
      entityType: "ops_job",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        job,
        reason: trimmedReason,
        success: true,
        result,
      },
    });

    revalidatePath("/admin/ops");
    return { success: true, result };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Manual run failed";
    await logAuditEventSafe({
      action: "ops_job_manual_run",
      entityType: "ops_job",
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        job,
        reason: trimmedReason,
        success: false,
        error: errorMessage,
      },
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function retryCircleSyncItemAction(
  itemId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("circle_sync_queue")
    .update({
      status: "pending",
      next_retry_at: now,
      last_error: null,
      processed_at: null,
    })
    .eq("id", itemId);

  if (error) {
    await logAuditEventSafe({
      action: "circle_sync_retry_request",
      entityType: "circle_sync_queue",
      entityId: itemId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        itemId,
        reason: trimmedReason,
        success: false,
        error: error.message,
      },
    });
    return { success: false, error: `Failed to queue retry: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "circle_sync_retry_request",
    entityType: "circle_sync_queue",
    entityId: itemId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { itemId, reason: trimmedReason, success: true },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function resolveCircleSyncItemAction(
  itemId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("circle_sync_queue")
    .update({
      status: "resolved",
      processed_at: now,
      next_retry_at: null,
      last_error: trimmedReason,
    })
    .eq("id", itemId);

  if (error) {
    await logAuditEventSafe({
      action: "circle_sync_resolve_request",
      entityType: "circle_sync_queue",
      entityId: itemId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        itemId,
        reason: trimmedReason,
        success: false,
        error: error.message,
      },
    });
    return { success: false, error: `Failed to resolve sync item: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "circle_sync_resolve_request",
    entityType: "circle_sync_queue",
    entityId: itemId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { itemId, reason: trimmedReason, success: true },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function skipCircleSyncItemAction(
  itemId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("circle_sync_queue")
    .update({
      status: "skipped",
      processed_at: now,
      next_retry_at: null,
      last_error: trimmedReason,
    })
    .eq("id", itemId);

  if (error) {
    await logAuditEventSafe({
      action: "circle_sync_skip_request",
      entityType: "circle_sync_queue",
      entityId: itemId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        itemId,
        reason: trimmedReason,
        success: false,
        error: error.message,
      },
    });
    return { success: false, error: `Failed to skip sync item: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "circle_sync_skip_request",
    entityType: "circle_sync_queue",
    entityId: itemId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { itemId, reason: trimmedReason, success: true },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function retryInvoiceChargeAction(
  invoiceId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { data: invoice, error: invoiceError } = await db
    .from("invoices")
    .select("id, stripe_invoice_id, status")
    .eq("id", invoiceId)
    .single();

  if (invoiceError || !invoice) {
    return { success: false, error: invoiceError?.message ?? "Invoice not found." };
  }

  if (!invoice.stripe_invoice_id) {
    return { success: false, error: "Invoice has no linked Stripe invoice id." };
  }

  try {
    const stripeInvoice = await stripe.invoices.pay(invoice.stripe_invoice_id);
    const paidAtUnix = stripeInvoice.status_transitions?.paid_at ?? null;
    const paidAtIso = paidAtUnix ? new Date(paidAtUnix * 1000).toISOString() : null;
    const nextStatus = stripeInvoice.status === "paid" ? "paid" : "pending_settlement";
    const now = new Date().toISOString();

    const { error: updateError } = await db
      .from("invoices")
      .update({
        status: nextStatus,
        paid_at: paidAtIso,
        updated_at: now,
      })
      .eq("id", invoiceId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await logAuditEventSafe({
      action: "invoice_retry_charge_request",
      entityType: "invoice",
      entityId: invoiceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: true,
        reason: trimmedReason,
        previousStatus: invoice.status,
        nextStatus,
        stripeInvoiceId: invoice.stripe_invoice_id,
      },
    });

    revalidatePath("/admin/ops");
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logAuditEventSafe({
      action: "invoice_retry_charge_request",
      entityType: "invoice",
      entityId: invoiceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        reason: trimmedReason,
        error: errorMessage,
        stripeInvoiceId: invoice.stripe_invoice_id,
      },
    });
    return { success: false, error: errorMessage };
  }
}

export async function voidInvoiceAction(
  invoiceId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { data: invoice, error: invoiceError } = await db
    .from("invoices")
    .select("id, stripe_invoice_id, status")
    .eq("id", invoiceId)
    .single();

  if (invoiceError || !invoice) {
    return { success: false, error: invoiceError?.message ?? "Invoice not found." };
  }

  if (["voided", "paid", "refunded_full", "refunded_partial"].includes(invoice.status)) {
    return {
      success: false,
      error: `Invoice in terminal status (${invoice.status}); cannot void.`,
    };
  }

  try {
    if (invoice.stripe_invoice_id) {
      const stripeInvoice = await stripe.invoices.retrieve(invoice.stripe_invoice_id);
      if (stripeInvoice.status === "open") {
        await stripe.invoices.voidInvoice(invoice.stripe_invoice_id);
      } else if (stripeInvoice.status === "draft") {
        await stripe.invoices.del(invoice.stripe_invoice_id);
      }
    }

    const { error: updateError } = await db
      .from("invoices")
      .update({
        status: "voided",
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await logAuditEventSafe({
      action: "invoice_void_request",
      entityType: "invoice",
      entityId: invoiceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: true,
        reason: trimmedReason,
        previousStatus: invoice.status,
        stripeInvoiceId: invoice.stripe_invoice_id,
      },
    });

    revalidatePath("/admin/ops");
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logAuditEventSafe({
      action: "invoice_void_request",
      entityType: "invoice",
      entityId: invoiceId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        success: false,
        reason: trimmedReason,
        error: errorMessage,
        stripeInvoiceId: invoice.stripe_invoice_id,
      },
    });
    return { success: false, error: errorMessage };
  }
}

export async function replayStripeWebhookEventAction(
  stripeEventId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  try {
    const db = createAdminClient();
    const event = await stripe.events.retrieve(stripeEventId);

    if (!isHandledStripeWebhookEvent(event.type)) {
      await logAuditEventSafe({
        action: "stripe_webhook_replay_attempt",
        entityType: "stripe_webhook_event",
        entityId: stripeEventId,
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          stripeEventId,
          reason: trimmedReason,
          success: false,
          error: `Event type '${event.type}' is not in handled webhook set.`,
        },
      });
      return {
        success: false,
        error: `Event type '${event.type}' is not in handled webhook set.`,
      };
    }

    try {
      const context = await processStripeWebhookEvent(event, db);

      await db.from("stripe_webhook_events").upsert({
        id: event.id,
        type: event.type,
        result: "success",
        error_message: null,
        payload: toWebhookPayloadJson(event),
        processed_at: new Date().toISOString(),
      });

      await recordConferenceWebhookEvent({
        db,
        event,
        conferenceOrderId:
          context.conferenceOrderId ?? extractConferenceOrderIdFromStripeEvent(event),
        success: true,
      });
    } catch (processingError) {
      const message =
        processingError instanceof Error
          ? processingError.message
          : "Unknown replay processing error";

      await db.from("stripe_webhook_events").upsert({
        id: event.id,
        type: event.type,
        result: "error",
        error_message: message,
        payload: toWebhookPayloadJson(event),
        processed_at: new Date().toISOString(),
      });

      await recordConferenceWebhookEvent({
        db,
        event,
        conferenceOrderId: extractConferenceOrderIdFromStripeEvent(event),
        success: false,
        errorMessage: message,
      });

      await logAuditEventSafe({
        action: "stripe_webhook_replay_attempt",
        entityType: "stripe_webhook_event",
        entityId: stripeEventId,
        actorId: auth.ctx.userId,
        actorType: "user",
        details: {
          stripeEventId,
          reason: trimmedReason,
          success: false,
          error: message,
        },
      });

      return { success: false, error: `Replay failed: ${message}` };
    }

    await logAuditEventSafe({
      action: "stripe_webhook_replay_attempt",
      entityType: "stripe_webhook_event",
      entityId: stripeEventId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { stripeEventId, reason: trimmedReason, success: true },
    });

    revalidatePath("/admin/ops");
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Replay failed";
    await logAuditEventSafe({
      action: "stripe_webhook_replay_attempt",
      entityType: "stripe_webhook_event",
      entityId: stripeEventId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        stripeEventId,
        reason: trimmedReason,
        success: false,
        error: errorMessage,
      },
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function replayConferenceWebhookEventAction(
  stripeEventId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { data: conferenceWebhook, error } = await db
    .from("conference_webhook_events")
    .select("stripe_event_id, event_type, success")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();

  if (error || !conferenceWebhook) {
    const msg = error?.message ?? "Conference webhook row not found";
    await logAuditEventSafe({
      action: "conference_webhook_replay_attempt",
      entityType: "conference_webhook_event",
      entityId: stripeEventId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: {
        stripeEventId,
        reason: trimmedReason,
        success: false,
        error: msg,
      },
    });
    return { success: false, error: msg };
  }

  const replayResult = await replayStripeWebhookEventAction(stripeEventId, trimmedReason);

  await logAuditEventSafe({
    action: "conference_webhook_replay_attempt",
    entityType: "conference_webhook_event",
    entityId: stripeEventId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      stripeEventId,
      eventType: conferenceWebhook.event_type,
      reason: trimmedReason,
      success: replayResult.success,
      error: replayResult.error ?? null,
    },
  });

  return replayResult;
}

export async function deleteSchedulerRunAction(
  runId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { data: run, error: loadError } = await db
    .from("scheduler_runs")
    .select("id, conference_id, run_mode, status, started_at, completed_at")
    .eq("id", runId)
    .maybeSingle();

  if (loadError || !run) {
    return { success: false, error: loadError?.message ?? "Scheduler run not found." };
  }

  if (run.status === "running") {
    return { success: false, error: "Cannot delete a scheduler run while it is running." };
  }
  if (run.run_mode === "active") {
    return { success: false, error: "Cannot delete the active scheduler run." };
  }

  const { error: deleteError } = await db
    .from("scheduler_runs")
    .delete()
    .eq("id", runId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  await logAuditEventSafe({
    action: "scheduler_run_delete_request",
    entityType: "scheduler_runs",
    entityId: runId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      reason: trimmedReason,
      conferenceId: run.conference_id,
      previousRunMode: run.run_mode,
      previousStatus: run.status,
      startedAt: run.started_at,
      completedAt: run.completed_at,
    },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function retryQBExportAction(
  rowId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("qbo_export_queue")
    .update({
      status: "pending",
      retry_count: 0,
      next_retry_at: null,
      error_message: null,
      lease_expires_at: null,
    })
    .eq("id", rowId);

  if (error) {
    await logAuditEventSafe({
      action: "qbo_export_retry_request",
      entityType: "qbo_export_queue",
      entityId: rowId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { rowId, reason: trimmedReason, success: false, error: error.message },
    });
    return { success: false, error: `Failed to queue retry: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "qbo_export_retry_request",
    entityType: "qbo_export_queue",
    entityId: rowId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { rowId, reason: trimmedReason, success: true },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function ignoreQBReconciliationItemAction(
  rowId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("qbo_reconciliation_queue")
    .update({
      status: "ignored",
      notes: trimmedReason,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", rowId);

  if (error) {
    await logAuditEventSafe({
      action: "qbo_reconciliation_ignore_request",
      entityType: "qbo_reconciliation_queue",
      entityId: rowId,
      actorId: auth.ctx.userId,
      actorType: "user",
      details: { rowId, reason: trimmedReason, success: false, error: error.message },
    });
    return { success: false, error: `Failed to ignore item: ${error.message}` };
  }

  await logAuditEventSafe({
    action: "qbo_reconciliation_ignore_request",
    entityType: "qbo_reconciliation_queue",
    entityId: rowId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { rowId, reason: trimmedReason, success: true },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}

export async function deleteBillingRunAction(
  runId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 8) {
    return { success: false, error: "Reason is required (minimum 8 characters)." };
  }

  const db = createAdminClient();
  const { data: run, error: loadError } = await db
    .from("billing_runs")
    .select("id, conference_id, status, started_at, completed_at, total_items, failed_items")
    .eq("id", runId)
    .maybeSingle();

  if (loadError || !run) {
    return { success: false, error: loadError?.message ?? "Billing run not found." };
  }

  if (run.status === "running") {
    return { success: false, error: "Cannot delete a billing run while it is running." };
  }

  const { error: deleteError } = await db
    .from("billing_runs")
    .delete()
    .eq("id", runId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  await logAuditEventSafe({
    action: "billing_run_delete_request",
    entityType: "billing_runs",
    entityId: runId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      success: true,
      reason: trimmedReason,
      conferenceId: run.conference_id,
      previousStatus: run.status,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      totalItems: run.total_items,
      failedItems: run.failed_items,
    },
  });

  revalidatePath("/admin/ops");
  return { success: true };
}
