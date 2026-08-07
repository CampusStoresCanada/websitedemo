"use client";

import { useState, useRef, useEffect } from "react";

function localInputNow(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
import Link from "next/link";
import type { MessageTemplate, AudienceType } from "@/lib/comms/types";
import TemplateBodyEditor from "./TemplateBodyEditor";
import EmailPreviewModal from "./EmailPreviewModal";
import { SYSTEM_VARIABLE_KEYS } from "@/lib/comms/variables/registry";
import { CONTACT_TAGS } from "@/lib/contacts/tags";
import { Eye, Calendar, Send, FileText } from "lucide-react";

type SendTiming = "draft" | "immediate" | "scheduled";

interface ConferenceOption {
  id: string;
  name: string;
  status: string;
}

interface ConferenceEntityOption {
  id: string;
  name: string;
  kind: string;
}

const AUDIENCE_OPTIONS: { value: AudienceType; label: string }[] = [
  { value: "conference_all", label: "All Conference Attendees" },
  { value: "conference_holders", label: "Conference seat-holders (v3)" },
  { value: "conference_orgs_with_open_seats", label: "Orgs with unassigned seats" },
  { value: "conference_orgs_fully_assigned", label: "Orgs — all seats assigned" },
  { value: "org_admins", label: "All Org Admins" },
  { value: "contact_tags", label: "Tagged Contacts (lapsed, prospects, board, etc.)" },
  { value: "custom_emails", label: "Custom Email List" },
  { value: "custom_recipient_list", label: "Individual / Mail Merge (paste a list)" },
];

// Auto-filled per recipient from real data during audience resolution
// (see lib/comms/audience.ts) — typing a value here overrides that
// per-recipient value with the same one for everyone, so leave these
// blank unless that's actually what's wanted. Sourced from the same
// registry lib/comms/audience.ts is typed against, so this list can't
// silently drift from what's actually computed.
const AUTO_FILLED_VARIABLE_KEYS = new Set<string>(SYSTEM_VARIABLE_KEYS);

const ENTITY_SCOPED_AUDIENCES = new Set<AudienceType>([
  "conference_holders",
  "conference_orgs_with_open_seats",
  "conference_orgs_fully_assigned",
]);

interface ConditionOption {
  key: string;
  label: string;
}

interface NewCampaignFormProps {
  action: (formData: FormData) => Promise<void>;
  templates: MessageTemplate[];
  conferences: ConferenceOption[];
  entitiesByConference: Record<string, ConferenceEntityOption[]>;
  defaultConferenceId?: string;
  /** When set, this send is tied to a campaign initiative and `templates` is that campaign's own roster, not the shared library. */
  campaignId?: string;
  campaignName?: string;
  defaultTemplateId?: string;
  conditions: ConditionOption[];
}

export default function NewCampaignForm({
  action,
  templates,
  conferences,
  entitiesByConference,
  defaultConferenceId,
  campaignId,
  campaignName,
  defaultTemplateId,
  conditions,
}: NewCampaignFormProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId ?? "");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendTiming, setSendTiming] = useState<SendTiming>("draft");
  const [selectedConferenceId, setSelectedConferenceId] = useState(defaultConferenceId ?? "");
  const [selectedAudienceType, setSelectedAudienceType] = useState<AudienceType>(
    AUDIENCE_OPTIONS[0].value
  );
  const [selectedContactTags, setSelectedContactTags] = useState<Set<string>>(new Set());
  const subjectRef = useRef<HTMLInputElement>(null);

  const conferenceEntities = entitiesByConference[selectedConferenceId] ?? [];
  const entitiesByKind = conferenceEntities.reduce<Record<string, ConferenceEntityOption[]>>(
    (acc, e) => {
      (acc[e.kind] ??= []).push(e);
      return acc;
    },
    {}
  );

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    const tmpl = templates.find((t) => t.id === id);
    setVariableValues(
      tmpl ? Object.fromEntries(tmpl.variable_keys.map((k) => [k, ""])) : {}
    );
    // Pre-fill subject from template
    if (subjectRef.current) {
      subjectRef.current.value = tmpl?.subject ?? "";
    }
  };

  // Pre-fill subject/variables when arriving with a template already chosen
  // (e.g. from a campaign's roster "Send" link).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (defaultTemplateId) handleTemplateChange(defaultTemplateId);
  }, []);

  const getCurrentBody = () =>
    (document.querySelector('textarea[name="body_html"]') as HTMLTextAreaElement)?.value ?? "";

  const getCurrentSubject = () => subjectRef.current?.value ?? "";

  return (
    <>
      <form action={action} className="mt-6 max-w-3xl space-y-5">

        {campaignId && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5">
            <p className="text-xs text-blue-800">
              Part of campaign: <span className="font-medium">{campaignName}</span>
            </p>
            <input type="hidden" name="campaign_id" value={campaignId} />
          </div>
        )}

        {/* Campaign name */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Campaign Name <span className="text-[#EE2A2E]">*</span>
          </label>
          <input
            name="name"
            required
            placeholder="e.g. Conference Schedule Announcement — 2026"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        {/* Template selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Template</label>
          <p className="text-xs text-gray-500 mb-1">
            Optional. Selecting a template pre-fills subject and body — you can edit both below.
          </p>
          <select
            name="template_id"
            value={selectedTemplateId}
            onChange={(e) => handleTemplateChange(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          >
            <option value="">— No template (write custom) —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.category}] {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Variable values */}
        {selectedTemplate && selectedTemplate.variable_keys.length > 0 && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-3">
            <p className="text-xs font-medium text-blue-800">
              Template Variables{" "}
              <span className="font-normal text-[#EE2A2E]">
                — fallback value used for any recipient without their own real per-recipient value
              </span>
            </p>
            {selectedTemplate.variable_keys.map((key) => {
              const isAutoFilled = AUTO_FILLED_VARIABLE_KEYS.has(key);
              return (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    <code className="bg-white rounded px-1 text-[#D92327]">{`{{${key}}}`}</code>
                    {isAutoFilled && (
                      <span className="ml-2 text-[10px] font-normal text-green-700">
                        auto-filled per recipient — this box is ignored whenever that's available
                      </span>
                    )}
                  </label>
                  <input
                    name={`var_${key}`}
                    value={variableValues[key] ?? ""}
                    onChange={(e) =>
                      setVariableValues((v) => ({ ...v, [key]: e.target.value }))
                    }
                    placeholder={isAutoFilled ? "Only used if a recipient has no real value for this" : `Value for ${key}`}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D] bg-white"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Subject <span className="text-[#EE2A2E]">*</span>
          </label>
          <input
            ref={subjectRef}
            name="subject"
            required
            defaultValue={selectedTemplate?.subject ?? ""}
            placeholder="Email subject line"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        {/* Body editor — key forces TipTap to remount with new content on template change */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Body</label>
          <p className="text-xs text-gray-500 mb-1">
            Use{" "}
            <code className="bg-gray-100 rounded px-1 text-xs">{`{{variable_name}}`}</code>{" "}
            tokens — replaced when the email is sent.
          </p>
          <TemplateBodyEditor
            key={selectedTemplateId}
            initialHtml={selectedTemplate?.body_html ?? ""}
            fieldName="body_html"
          />
        </div>

        {/* Audience */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Audience <span className="text-[#EE2A2E]">*</span>
          </label>
          <select
            name="audience_type"
            required
            value={selectedAudienceType}
            onChange={(e) => setSelectedAudienceType(e.target.value as AudienceType)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Org type filter — only relevant for the Org Admins audience */}
        {selectedAudienceType === "org_admins" && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Organization type (optional)</label>
            <p className="text-xs text-gray-500 mb-1">Narrows "All Org Admins" to just one side of membership.</p>
            <select
              name="org_type"
              defaultValue=""
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            >
              <option value="">— Any org type —</option>
              <option value="Member">Member</option>
              <option value="Vendor Partner">Vendor Partner</option>
              <option value="Non-Member">Non-Member</option>
            </select>
          </div>
        )}

        {/* Contact tags filter — only relevant for the Tagged Contacts audience */}
        {selectedAudienceType === "contact_tags" && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Tags (any match)</label>
            <p className="text-xs text-gray-500 mb-1">
              Sends to contacts carrying any of the checked tags — never includes anyone with a portal login.
            </p>
            <div className="flex flex-wrap gap-2">
              {CONTACT_TAGS.map((tag) => {
                const checked = selectedContactTags.has(tag.value);
                return (
                  <label
                    key={tag.value}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                      checked
                        ? "bg-[#163D6D] text-white"
                        : "bg-white border border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="contact_tags"
                      value={tag.value}
                      checked={checked}
                      onChange={() => {
                        setSelectedContactTags((prev) => {
                          const next = new Set(prev);
                          checked ? next.delete(tag.value) : next.add(tag.value);
                          return next;
                        });
                      }}
                      className="sr-only"
                    />
                    {tag.label}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Conference filter */}
        {conferences.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Conference (for conference audience types)
            </label>
            <select
              name="conference_id"
              value={selectedConferenceId}
              onChange={(e) => setSelectedConferenceId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            >
              <option value="">— All conferences —</option>
              {conferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Target item — pulled live from the selected conference's own catalog,
            not a fixed list. Admins pick from what that conference actually
            contains instead of remembering category names. */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Target item (optional)</label>
          <p className="text-xs text-gray-500 mb-1">
            Only used with{" "}
            {AUDIENCE_OPTIONS.filter((o) => ENTITY_SCOPED_AUDIENCES.has(o.value))
              .map((o) => `"${o.label}"`)
              .join(", ")}
            . Narrows to people/orgs holding this specific catalog item. Blank = any item.
            {!selectedConferenceId && " Pick a conference above to see its items."}
          </p>
          <select
            key={selectedConferenceId}
            name="entity_id"
            defaultValue=""
            disabled={conferenceEntities.length === 0}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D] disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="">— Any item —</option>
            {Object.entries(entitiesByKind).map(([kind, items]) => (
              <optgroup key={kind} label={kind}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Segment by condition */}
        {conditions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Refine Audience (optional)</label>
            <p className="text-xs text-gray-500 mb-1">
              Only send to recipients who also satisfy these. Doesn&apos;t apply to Custom Email List / mail merge,
              since there&apos;s no linked profile to check.
            </p>
            <div className="rounded-lg border border-gray-200 p-3 space-y-2.5">
              <div className="flex items-center gap-3 text-xs text-gray-600 pb-1.5 border-b border-gray-100">
                <span className="font-medium">Match:</span>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="condition_match" value="all" defaultChecked className="text-accent focus:ring-accent" />
                  All of these
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="condition_match" value="any" className="text-accent focus:ring-accent" />
                  Any of these
                </label>
              </div>
              <div className="space-y-1.5">
                {conditions.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      name="condition_keys"
                      value={c.key}
                      className="rounded border-gray-300 text-accent focus:ring-accent"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Custom emails */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Custom Emails (one per line or comma-separated)
          </label>
          <p className="text-xs text-gray-500 mb-1">
            Only used when Audience is set to &ldquo;Custom Email List&rdquo;.
          </p>
          <textarea
            name="custom_emails"
            rows={4}
            placeholder={"user@example.com\nanother@example.com"}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        {/* Mail merge — each row gets its own personalized email, not one
            shared body. Header row's extra columns become {{variables}}
            for that recipient only, overriding the shared values above. */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Mail Merge Recipients (CSV)</label>
          <p className="text-xs text-gray-500 mb-1">
            Only used when Audience is set to &ldquo;Individual / Mail Merge&rdquo;. First row is headers:{" "}
            <code className="bg-gray-100 rounded px-1">email</code>,{" "}
            <code className="bg-gray-100 rounded px-1">name</code>, then any{" "}
            <code className="bg-gray-100 rounded px-1">{`{{variable}}`}</code> column names — each becomes that one
            recipient&apos;s personal value, overriding the shared Template Variables above just for them.
          </p>
          <textarea
            name="mail_merge_csv"
            rows={6}
            placeholder={`email,name${selectedTemplate?.variable_keys.length ? "," + selectedTemplate.variable_keys.join(",") : ""}\njane@example.com,Jane Doe${selectedTemplate?.variable_keys.map(() => ",...").join("") ?? ""}`}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        {/* Send timing */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Sending</label>
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: "draft",     icon: FileText, label: "Save as Draft",      hint: "Send manually later" },
              { value: "immediate", icon: Send,     label: "Send Immediately",   hint: "Sends as soon as you save" },
              { value: "scheduled", icon: Calendar, label: "Schedule for Later", hint: "Pick a date and time" },
            ] as { value: SendTiming; icon: React.ComponentType<{ size: number; className?: string }>; label: string; hint: string }[]).map(({ value, icon: Icon, label, hint }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSendTiming(value)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left transition-colors ${
                  sendTiming === value
                    ? "border-[#163D6D] bg-[#EE2A2E]/5 text-[#EE2A2E]"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon size={16} className={sendTiming === value ? "text-[#EE2A2E]" : "text-gray-400"} />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-gray-500">{hint}</span>
              </button>
            ))}
          </div>

          {sendTiming === "scheduled" && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Schedule date &amp; time
              </label>
              <input
                name="scheduled_at"
                type="datetime-local"
                required
                min={localInputNow(5 * 60000)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
              />
              <p className="mt-1 text-xs text-gray-500">
                Time is in your local timezone.
              </p>
            </div>
          )}
          <input type="hidden" name="send_timing" value={sendTiming} />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-[#EE2A2E] px-5 py-2 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
          >
            {sendTiming === "draft"     && "Save Draft"}
            {sendTiming === "immediate" && "Save and Send Now"}
            {sendTiming === "scheduled" && "Schedule Campaign"}
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Eye size={15} />
            Preview
          </button>
          <Link
            href="/admin/comms"
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      {previewOpen && (
        <EmailPreviewModal
          bodyHtml={getCurrentBody()}
          subject={getCurrentSubject()}
          variableKeys={selectedTemplate?.variable_keys ?? []}
          initialVariables={variableValues}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
