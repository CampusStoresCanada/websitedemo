"use client";

import { useState, useRef } from "react";

function localInputNow(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
import Link from "next/link";
import type { MessageTemplate, AudienceType } from "@/lib/comms/types";
import TemplateBodyEditor from "./TemplateBodyEditor";
import EmailPreviewModal from "./EmailPreviewModal";
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
  { value: "conference_delegates", label: "Conference Delegates (members)" },
  { value: "conference_exhibitors", label: "Conference Exhibitors (partners)" },
  { value: "conference_all", label: "All Conference Attendees" },
  { value: "conference_holders", label: "Conference seat-holders (v3)" },
  { value: "conference_orgs_with_open_seats", label: "Orgs with unassigned seats" },
  { value: "conference_orgs_fully_assigned", label: "Orgs — all seats assigned" },
  { value: "org_admins", label: "All Org Admins" },
  { value: "custom_emails", label: "Custom Email List" },
  { value: "custom_recipient_list", label: "Individual / Mail Merge (paste a list)" },
];

const ENTITY_SCOPED_AUDIENCES = new Set<AudienceType>([
  "conference_holders",
  "conference_orgs_with_open_seats",
  "conference_orgs_fully_assigned",
]);

interface NewCampaignFormProps {
  action: (formData: FormData) => Promise<void>;
  templates: MessageTemplate[];
  conferences: ConferenceOption[];
  entitiesByConference: Record<string, ConferenceEntityOption[]>;
  defaultConferenceId?: string;
}

export default function NewCampaignForm({
  action,
  templates,
  conferences,
  entitiesByConference,
  defaultConferenceId,
}: NewCampaignFormProps) {
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendTiming, setSendTiming] = useState<SendTiming>("draft");
  const [selectedConferenceId, setSelectedConferenceId] = useState(defaultConferenceId ?? "");
  const subjectRef = useRef<HTMLInputElement>(null);

  const conferenceEntities = entitiesByConference[selectedConferenceId] ?? [];
  const entitiesByKind = conferenceEntities.reduce<Record<string, ConferenceEntityOption[]>>(
    (acc, e) => {
      (acc[e.kind] ??= []).push(e);
      return acc;
    },
    {}
  );

  const selectedTemplate = templates.find((t) => t.key === selectedTemplateKey) ?? null;

  const handleTemplateChange = (key: string) => {
    setSelectedTemplateKey(key);
    const tmpl = templates.find((t) => t.key === key);
    setVariableValues(
      tmpl ? Object.fromEntries(tmpl.variable_keys.map((k) => [k, ""])) : {}
    );
    // Pre-fill subject from template
    if (subjectRef.current) {
      subjectRef.current.value = tmpl?.subject ?? "";
    }
  };

  const getCurrentBody = () =>
    (document.querySelector('textarea[name="body_html"]') as HTMLTextAreaElement)?.value ?? "";

  const getCurrentSubject = () => subjectRef.current?.value ?? "";

  return (
    <>
      <form action={action} className="mt-6 max-w-3xl space-y-5">

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
            name="template_key"
            value={selectedTemplateKey}
            onChange={(e) => handleTemplateChange(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          >
            <option value="">— No template (write custom) —</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
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
                — merged into every email sent by this campaign
              </span>
            </p>
            {selectedTemplate.variable_keys.map((key) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  <code className="bg-white rounded px-1 text-[#D92327]">{`{{${key}}}`}</code>
                </label>
                <input
                  name={`var_${key}`}
                  value={variableValues[key] ?? ""}
                  onChange={(e) =>
                    setVariableValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                  placeholder={`Value for ${key}`}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D] bg-white"
                />
              </div>
            ))}
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
            key={selectedTemplateKey}
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
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

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
