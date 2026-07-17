"use client";

import { useState, useEffect } from "react";
import { parseUTC } from "@/lib/utils";
import RichTextEditor from "@/components/ui/RichTextEditor";
import {
  getLegalVersions,
  createLegalVersion,
  updateLegalVersion,
  getLegalAcceptanceStats,
  getLegalTargeting,
  setPolicyAppliesToAll,
  setPolicyWhoAudiences,
  setPolicyAcceptBy,
  type LegalTargeting,
  type LegalDocTargeting,
} from "@/lib/actions/conference-legal";
import {
  LEGAL_DOCUMENT_TYPES,
  LEGAL_DOCUMENT_LABELS,
  POLICY_ACCEPT_BY,
  POLICY_ACCEPT_BY_LABELS,
  isConferenceOnSale,
  type LegalDocumentType,
  type ConferenceStatus,
  type PolicyAcceptBy,
} from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];

interface LegalManagerProps {
  conferenceId: string;
  conferenceStatus: string;
}

/** Convert a stored timestamp into a `datetime-local` input value (local time). */
function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function LegalManager({ conferenceId, conferenceStatus }: LegalManagerProps) {
  // In-place editing mutates a version's content, which would change what
  // attendees already agreed to. So it's only allowed before the conference is
  // on sale; afterwards admins must add a new version instead.
  const canEditInPlace = !isConferenceOnSale(conferenceStatus as ConferenceStatus);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [versions, setVersions] = useState<LegalVersionRow[]>([]);
  const [statsByVersionId, setStatsByVersionId] = useState<
    Record<string, { total: number; accepted: number; pending: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<LegalTargeting | null>(null);

  useEffect(() => {
    loadVersions();
    loadTargeting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTargeting = async () => {
    const result = await getLegalTargeting(conferenceId);
    if (result.success) setTargeting(result.data ?? null);
  };

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
          className="px-3 py-1.5 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-hover"
        >
          Add Version
        </button>
      </div>

      {!canEditInPlace && versions.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Registration is open, so documents are locked for in-place editing — this keeps them matched to what attendees already accepted. To change a document, use <span className="font-medium">Add Version</span> to publish a new one.
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {showAdd && (
        <LegalVersionEditor
          conferenceId={conferenceId}
          onSave={async () => {
            setShowAdd(false);
            await Promise.all([loadVersions(), loadTargeting()]);
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
          {versions.map((v) =>
            editingId === v.id ? (
              <LegalVersionEditor
                key={v.id}
                conferenceId={conferenceId}
                existing={v}
                onSave={async () => {
                  setEditingId(null);
                  await Promise.all([loadVersions(), loadTargeting()]);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={v.id} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <div className="font-medium text-sm text-gray-900">
                      {LEGAL_DOCUMENT_LABELS[v.document_type as LegalDocumentType] ?? v.document_type}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Version {v.version} &middot; Effective {parseUTC(v.effective_at).toLocaleDateString()}
                    </div>
                  </div>
                  {canEditInPlace && (
                    <button
                      onClick={() => {
                        setShowAdd(false);
                        setEditingId(v.id);
                      }}
                      className="flex-shrink-0 px-2.5 py-1 text-xs font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <div
                  className="mt-2 text-xs text-gray-600 max-h-20 overflow-hidden prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: v.content }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Acceptance: {statsByVersionId[v.id]?.accepted ?? 0}/
                  {statsByVersionId[v.id]?.total ?? 0} accepted
                  {statsByVersionId[v.id]
                    ? ` (${statsByVersionId[v.id].pending} pending)`
                    : ""}
                </div>
                {targeting && (
                  <TargetingPanel
                    conferenceId={conferenceId}
                    doc={targeting.byDocumentType[v.document_type]}
                    audiences={targeting.audiences}
                    onChange={loadTargeting}
                  />
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function LegalVersionEditor({
  conferenceId,
  existing,
  onSave,
  onCancel,
}: {
  conferenceId: string;
  existing?: LegalVersionRow;
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = Boolean(existing);
  const [docType, setDocType] = useState<string>(existing?.document_type ?? LEGAL_DOCUMENT_TYPES[0]);
  const [version, setVersion] = useState(existing?.version ?? 1);
  const [content, setContent] = useState(existing?.content ?? "");
  const [effectiveAt, setEffectiveAt] = useState(() =>
    toDateTimeLocal(existing ? parseUTC(existing.effective_at) : new Date())
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isEmpty = content.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim().length === 0;
    if (isEmpty) {
      setError("Content is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const result = existing
      ? await updateLegalVersion(existing.id, {
          document_type: docType,
          version,
          content,
          effective_at: new Date(effectiveAt).toISOString(),
        })
      : await createLegalVersion({
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
      setError(result.error ?? (isEdit ? "Failed to save" : "Failed to create"));
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
        <RichTextEditor
          value={content}
          onChange={setContent}
          placeholder="Legal document text — type / for formatting"
          minHeight="160px"
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm font-medium text-white bg-accent rounded-md hover:bg-accent-hover disabled:opacity-50">
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}

// ─── Targeting: who must accept this document ──────────────────────────────────

function TargetingPanel({
  conferenceId,
  doc,
  audiences,
  onChange,
}: {
  conferenceId: string;
  doc: LegalDocTargeting | undefined;
  audiences: LegalTargeting["audiences"];
  onChange: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  if (!doc || !doc.policyEntityId) {
    return (
      <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-400">
        Not yet linked to the catalog — save a version to make this document targetable.
      </div>
    );
  }
  const { policyEntityId, appliesToAll, whoAudienceIds, requiredBy, acceptBy } = doc;
  const selected = new Set(whoAudienceIds);

  const toggleUniversal = async () => {
    setSaving(true);
    await setPolicyAppliesToAll(policyEntityId, !appliesToAll);
    await onChange();
    setSaving(false);
  };
  const changeAcceptBy = async (value: PolicyAcceptBy) => {
    setSaving(true);
    await setPolicyAcceptBy(policyEntityId, value);
    await onChange();
    setSaving(false);
  };
  const toggleAudience = async (audienceId: string) => {
    setSaving(true);
    const next = new Set(selected);
    if (next.has(audienceId)) next.delete(audienceId);
    else next.add(audienceId);
    await setPolicyWhoAudiences(conferenceId, policyEntityId, [...next]);
    await onChange();
    setSaving(false);
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Who must accept this</span>
        {saving && <span className="text-[10px] text-gray-400">Saving…</span>}
      </div>
      <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-700">
        <span className="text-gray-500">Accepted by</span>
        <select
          value={acceptBy ?? "both"}
          disabled={saving}
          onChange={(e) => changeAcceptBy(e.target.value as PolicyAcceptBy)}
          className="px-2 py-1 border border-gray-300 rounded text-xs"
        >
          {POLICY_ACCEPT_BY.map((v) => (
            <option key={v} value={v}>{POLICY_ACCEPT_BY_LABELS[v]}</option>
          ))}
        </select>
      </label>
      <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-700">
        <input type="checkbox" checked={appliesToAll} disabled={saving} onChange={toggleUniversal} />
        Applies to everyone
      </label>
      {!appliesToAll && (
        <div className="mt-2">
          <div className="text-[11px] text-gray-500 mb-1">Or target specific audiences:</div>
          <div className="flex flex-wrap gap-1.5">
            {audiences.map((a) => {
              const on = selected.has(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={saving}
                  onClick={() => toggleAudience(a.id)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] border transition-colors ${on ? "bg-accent text-white border-accent" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {requiredBy.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-500">
          Also required by: {requiredBy.map((r) => r.name).join(", ")}
          <span className="text-gray-400"> · wired on the offer in the Build tab</span>
        </div>
      )}
      {!appliesToAll && whoAudienceIds.length === 0 && requiredBy.length === 0 && (
        <div className="mt-2 text-[11px] text-amber-600">No audience or offer selected — this document is currently shown to no one.</div>
      )}
    </div>
  );
}
