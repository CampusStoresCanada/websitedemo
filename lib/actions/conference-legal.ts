"use server";

import { isGlobalAdmin, requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];
type LegalVersionInsert = Database["public"]["Tables"]["conference_legal_versions"]["Insert"];
type LegalAcceptanceRow = Database["public"]["Tables"]["legal_acceptances"]["Row"];

// ─────────────────────────────────────────────────────────────────
// Public: Get active legal documents for a conference
// ─────────────────────────────────────────────────────────────────

export async function getActiveLegalDocuments(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Get the latest version of each document type for this conference
  const { data, error } = await auth.ctx.supabase
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", conferenceId)
    .lte("effective_at", new Date().toISOString())
    .order("version", { ascending: false });

  if (error) return { success: false, error: error.message };

  // Keep only the latest version per document_type
  const latestByType = new Map<string, LegalVersionRow>();
  for (const doc of data ?? []) {
    if (!latestByType.has(doc.document_type)) {
      latestByType.set(doc.document_type, doc);
    }
  }

  return { success: true, data: Array.from(latestByType.values()) };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Create a legal version
// ─────────────────────────────────────────────────────────────────

export async function createLegalVersion(
  input: Omit<LegalVersionInsert, "id" | "created_at" | "created_by">
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_legal_versions")
    .insert({ ...input, created_by: auth.ctx.userId })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Get all legal versions for a conference
// ─────────────────────────────────────────────────────────────────

export async function getLegalVersions(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalVersionRow[] }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conference_legal_versions")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("document_type")
    .order("version", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}

// ─────────────────────────────────────────────────────────────────
// Authenticated: Accept a legal document
// ─────────────────────────────────────────────────────────────────

export async function acceptLegalDocument(
  legalVersionId: string,
  ipAddress?: string
): Promise<{ success: boolean; error?: string; data?: LegalAcceptanceRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  return recordLegalAcceptance(auth.ctx.userId, legalVersionId, ipAddress);
}

// ─────────────────────────────────────────────────────────────────
// Authenticated/Admin: Record legal acceptance for a user
// ─────────────────────────────────────────────────────────────────

export async function recordLegalAcceptance(
  userId: string,
  legalVersionId: string,
  ipAddress?: string
): Promise<{ success: boolean; error?: string; data?: LegalAcceptanceRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (userId !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to record this acceptance" };
  }

  const adminClient = createAdminClient();

  // Upsert — if already accepted, just return success
  const { data: existing } = await adminClient
    .from("legal_acceptances")
    .select("*")
    .eq("user_id", userId)
    .eq("legal_version_id", legalVersionId)
    .maybeSingle();

  if (existing) {
    return { success: true, data: existing };
  }

  const { data, error } = await adminClient
    .from("legal_acceptances")
    .insert({
      user_id: userId,
      legal_version_id: legalVersionId,
      ip_address: ipAddress ?? null,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

// ─────────────────────────────────────────────────────────────────
// Authenticated/Admin: Check legal acceptance completeness
// ─────────────────────────────────────────────────────────────────

export async function checkLegalAcceptance(
  userId: string,
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: { allAccepted: boolean; missing: string[] } }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (userId !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized to view this acceptance state" };
  }

  const adminClient = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: versions, error: versionsError } = await adminClient
    .from("conference_legal_versions")
    .select("id, document_type")
    .eq("conference_id", conferenceId)
    .lte("effective_at", nowIso)
    .order("document_type", { ascending: true })
    .order("version", { ascending: false });

  if (versionsError) return { success: false, error: versionsError.message };
  if (!versions || versions.length === 0) {
    return { success: true, data: { allAccepted: true, missing: [] } };
  }

  const latestByType = new Map<string, string>();
  for (const row of versions) {
    if (!latestByType.has(row.document_type)) {
      latestByType.set(row.document_type, row.id);
    }
  }
  const requiredVersionIds = [...latestByType.values()];

  const { data: acceptances, error: acceptancesError } = await adminClient
    .from("legal_acceptances")
    .select("legal_version_id")
    .eq("user_id", userId)
    .in("legal_version_id", requiredVersionIds);
  if (acceptancesError) return { success: false, error: acceptancesError.message };

  const acceptedIds = new Set((acceptances ?? []).map((row) => row.legal_version_id));
  const missing = [...latestByType.entries()]
    .filter(([, versionId]) => !acceptedIds.has(versionId))
    .map(([documentType]) => documentType);

  return {
    success: true,
    data: {
      allAccepted: missing.length === 0,
      missing,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Admin: Acceptance stats for one legal version
// ─────────────────────────────────────────────────────────────────

export async function getLegalAcceptanceStats(
  legalVersionId: string
): Promise<{
  success: boolean;
  error?: string;
  data?: { total: number; accepted: number; pending: number };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: legalVersion, error: legalVersionError } = await adminClient
    .from("conference_legal_versions")
    .select("id, conference_id")
    .eq("id", legalVersionId)
    .maybeSingle();
  if (legalVersionError) return { success: false, error: legalVersionError.message };
  if (!legalVersion) return { success: false, error: "Legal version not found" };

  const [registrationsRes, acceptancesRes] = await Promise.all([
    adminClient
      .from("conference_registrations")
      .select("user_id")
      .eq("conference_id", legalVersion.conference_id)
      .in("status", ["submitted", "confirmed"]),
    adminClient
      .from("legal_acceptances")
      .select("user_id")
      .eq("legal_version_id", legalVersionId),
  ]);

  if (registrationsRes.error) {
    return { success: false, error: registrationsRes.error.message };
  }
  if (acceptancesRes.error) {
    return { success: false, error: acceptancesRes.error.message };
  }

  const requiredUsers = new Set(
    (registrationsRes.data ?? []).map((row) => row.user_id)
  );
  const acceptedUsers = new Set(
    (acceptancesRes.data ?? [])
      .map((row) => row.user_id)
      .filter((userId) => requiredUsers.has(userId))
  );
  const total = requiredUsers.size;
  const accepted = acceptedUsers.size;
  const pending = Math.max(0, total - accepted);
  return { success: true, data: { total, accepted, pending } };
}

// ─────────────────────────────────────────────────────────────────
// Authenticated: Get my legal acceptances for a conference
// ─────────────────────────────────────────────────────────────────

export async function getMyLegalAcceptances(
  conferenceId: string
): Promise<{ success: boolean; error?: string; data?: LegalAcceptanceRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Get legal version IDs for this conference
  const { data: versions, error: verErr } = await auth.ctx.supabase
    .from("conference_legal_versions")
    .select("id")
    .eq("conference_id", conferenceId);

  if (verErr) return { success: false, error: verErr.message };

  if (!versions || versions.length === 0) {
    return { success: true, data: [] };
  }

  const { data, error } = await auth.ctx.supabase
    .from("legal_acceptances")
    .select("*")
    .eq("user_id", auth.ctx.userId)
    .in(
      "legal_version_id",
      versions.map((v) => v.id)
    );

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}
