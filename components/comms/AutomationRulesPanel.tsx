"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAutomationRule } from "@/lib/actions/automation-rules";
import type { MessageTemplate } from "@/lib/comms/types";

interface RuleRow {
  id: string;
  rule_key: string;
  label: string;
  template_key: string;
  automation_mode: string;
  enabled: boolean;
}

const inputClass =
  "rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent";

export default function AutomationRulesPanel({
  rules,
  templates,
}: {
  rules: RuleRow[];
  templates: MessageTemplate[];
}) {
  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Automation Rules</h2>
        <p className="mt-1 text-xs text-gray-500 max-w-2xl">
          Which template fires automatically on a system event (membership renewals, conference registrations, event
          review, etc.), whether it sends immediately or lands as a draft, and whether it&apos;s on at all — editable
          here instead of requiring a code change.
        </p>
      </div>
      {rules.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">No automation rules configured yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-600">Trigger</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Template</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Mode</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Enabled</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} templates={templates} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RuleRow({ rule, templates }: { rule: RuleRow; templates: MessageTemplate[] }) {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState(rule.template_key);
  const [mode, setMode] = useState(rule.automation_mode);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = templateKey !== rule.template_key || mode !== rule.automation_mode || enabled !== rule.enabled;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await updateAutomationRule(rule.id, {
      templateKey,
      automationMode: mode as "auto_send" | "draft_only",
      enabled,
    });
    setSaving(false);
    if (res.success) router.refresh();
    else setError(res.error);
  }

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <p className="text-gray-900">{rule.label}</p>
        <code className="text-xs text-gray-400">{rule.rule_key}</code>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-4 py-3 align-top">
        <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className={inputClass}>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              [{t.category}] {t.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 align-top">
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
          <option value="auto_send">Auto-send</option>
          <option value="draft_only">Draft only</option>
        </select>
      </td>
      <td className="px-4 py-3 align-top">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </td>
      <td className="px-4 py-3 align-top text-right">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </td>
    </tr>
  );
}
