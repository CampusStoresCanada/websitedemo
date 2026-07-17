"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseConferenceDocuments, type ConferenceDocument } from "@/lib/conference-documents";

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

export interface ResolvedConferenceDocument {
  id: string;
  label: string;
  href: string;
  isDocument: boolean;
}

/**
 * Resolves conference_instances.documents for display in the admin Documents
 * tab — generates signed URLs for stored files, passes external URLs through.
 * No viewer-level filtering: the whole /admin/conference/[id]/ area already
 * requires admin, so every document is visible to whoever can reach the page.
 */
export async function resolveConferenceDocuments(
  documents: ConferenceDocument[]
): Promise<ResolvedConferenceDocument[]> {
  const adminClient = createAdminClient();
  const resolved: ResolvedConferenceDocument[] = [];

  for (const doc of documents) {
    if (doc.storage_path) {
      const { data: signedData, error } = await adminClient.storage
        .from("conference-documents")
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

      if (error || !signedData?.signedUrl) {
        console.error("[resolveConferenceDocuments] failed to sign", doc.id, error);
        continue; // Skip broken documents silently
      }

      resolved.push({ id: doc.id, label: doc.label, href: signedData.signedUrl, isDocument: true });
    } else if (doc.url) {
      resolved.push({ id: doc.id, label: doc.label, href: doc.url, isDocument: false });
    }
  }

  return resolved;
}

/**
 * Called when an admin clicks "Open" on a stored document — re-signs on
 * demand so the tab page doesn't need to eagerly sign every document on
 * every load if a client-side refresh is preferred instead.
 */
export async function getConferenceDocumentUrl(
  conferenceId: string,
  documentId: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();
  const { data: conference, error: fetchError } = await adminClient
    .from("conference_instances")
    .select("documents")
    .eq("id", conferenceId)
    .single();

  if (fetchError || !conference) {
    return { success: false, error: "Conference not found" };
  }

  const documents = parseConferenceDocuments(conference.documents);
  const doc = documents.find((d) => d.id === documentId);

  if (!doc) return { success: false, error: "Document not found" };
  if (!doc.storage_path) return { success: false, error: "This entry is not a stored document" };

  const { data: signedData, error: signedError } = await adminClient.storage
    .from("conference-documents")
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    return { success: false, error: "Could not generate document URL" };
  }

  return { success: true, url: signedData.signedUrl };
}
