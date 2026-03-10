"use client";

import { useState, useEffect } from "react";
import {
  getLegalVersions,
  createLegalVersion,
  getLegalAcceptanceStats,
} from "@/lib/actions/conference-legal";
import {
  LEGAL_DOCUMENT_TYPES,
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentType,
} from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];

interface LegalManagerProps {
  conferenceId: string;
}

export default function LegalManager({ conferenceId }: LegalManagerProps) {
  const [versions, setVersions] = useState<LegalVersionRow[]>([]);
  const [statsByVersionId, setStatsByVersionId] = useState<
    Record<string, { total: number; accepted: number; pending: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadVersions = async () => {
    setLoading(true);
    const result = await getLegalVersions(conferenceId);
    setLoading(false);
    if (result.success) {
      const nextVersions = result.data ?? [];
      setVersions(nextVersions);
      const statsEntries = await Promise.all(
        nextVersions.map(async (version) => {
          const statsResult = await getLegalAcceptanceStats(version.id);
          return [
            version.id,
            statsResult.success && statsResult.data
              ? statsResult.data
              : { total: 0, accepted: 0, pending: 0 },
          ] as const;
        })
      );
      setStatsByVersionId(Object.fromEntries(statsEntries));
    } else {
      setError(result.error ?? "Failed to load");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-gray-700">{versions.length} legal documents</h3>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001]"
        >
          Add Version
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {showAdd && (
        <LegalVersionEditor
          conferenceId={conferenceId}
          onSave={async () => {
            setShowAdd(false);
            await loadVersions();
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
      ) : versions.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No legal documents yet.</div>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => (
            <div key={v.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm text-gray-900">
                    {LEGAL_DOCUMENT_LABELS[v.document_type as LegalDocumentType] ?? v.document_type}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Version {v.version} &middot; Effective {new Date(v.effective_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-600 max-h-20 overflow-hidden">
                {v.content.slice(0, 200)}{v.content.length > 200 ? "..." : ""}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Acceptance: {statsByVersionId[v.id]?.accepted ?? 0}/
                {statsByVersionId[v.id]?.total ?? 0} accepted
                {statsByVersionId[v.id]
                  ? ` (${statsByVersionId[v.id].pending} pending)`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LegalVersionEditor({
  conferenceId,
  onSave,
  onCancel,
}: {
  conferenceId: string;
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  const [docType, setDocType] = useState<string>(LEGAL_DOCUMENT_TYPES[0]);
  const [version, setVersion] = useState(1);
  const [content, setContent] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await createLegalVersion({
      conference_id: conferenceId,
      document_type: docType,
      version,
      content,
      effective_at: new Date(effectiveAt).toISOString(),
    });

    setSaving(false);
    if (result.success) {
      await onSave();
    } else {
      setError(result.error ?? "Failed to create");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      {error && <div className="p-2 rounded bg-red-50 text-xs text-red-700">{error}</div>}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Document Type</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm">
            {LEGAL_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{LEGAL_DOCUMENT_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Version</label>
          <input type="number" min={1} required value={version} onChange={(e) => setVersion(parseInt(e.target.value))} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Effective At</label>
          <input type="datetime-local" required value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Content *</label>
        <textarea required rows={6} value={content} onChange={(e) => setContent(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001] disabled:opacity-50">
          {saving ? "Saving..." : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}
