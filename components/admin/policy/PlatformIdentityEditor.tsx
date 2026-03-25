"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseUTC } from "@/lib/utils";
import type { PlatformConfig } from "@/lib/actions/platform-types";
import { savePlatformIdentity } from "@/lib/actions/platform";

interface Props {
  config: PlatformConfig;
  isSuperAdmin: boolean;
}

export default function PlatformIdentityEditor({ config, isSuperAdmin }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [clientName, setClientName] = useState(config.client_name);
  const [shortName, setShortName] = useState(config.client_short_name);
  const [domain, setDomain] = useState(config.client_domain);
  const [supportEmail, setSupportEmail] = useState(config.support_email);
  const [logoUrl, setLogoUrl] = useState(config.logo_url ?? "");
  const [primaryColor, setPrimaryColor] = useState(config.primary_color);

  async function handleSave() {
    if (!clientName.trim() || !shortName.trim() || !domain.trim() || !supportEmail.trim()) {
      setError("All required fields must be filled.");
      return;
    }
    setError(null);
    setSuccess(false);
    setSaving(true);
    const result = await savePlatformIdentity({
      client_name: clientName,
      client_short_name: shortName,
      client_domain: domain,
      support_email: supportEmail,
      logo_url: logoUrl || null,
      primary_color: primaryColor,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save.");
      return;
    }
    setSuccess(true);
    router.refresh();
  }

  const disabled = !isSuperAdmin;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Client Identity &amp; Branding
        </h3>
        {config.bootstrapped_at && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Bootstrapped{" "}
            {parseUTC(config.bootstrapped_at).toLocaleDateString("en-CA")}
          </span>
        )}
      </div>

      {!isSuperAdmin && (
        <p className="text-xs text-[var(--text-secondary)]">
          Only super admins can edit platform identity settings.
        </p>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-[var(--radius-md)] text-sm text-green-700">
          Identity updated successfully.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Client Name <span className="text-red-500">*</span>
          </span>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            disabled={disabled}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Short Name <span className="text-red-500">*</span>
          </span>
          <input
            type="text"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            disabled={disabled}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Domain <span className="text-red-500">*</span>
          </span>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={disabled}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Support Email <span className="text-red-500">*</span>
          </span>
          <input
            type="email"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            disabled={disabled}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Logo URL
          </span>
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            disabled={disabled}
            placeholder="https://..."
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Primary Color <span className="text-red-500">*</span>
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              disabled={disabled}
              className="h-9 w-9 rounded border border-[var(--border-default)] p-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              disabled={disabled}
              className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </label>
      </div>

      {isSuperAdmin && (
        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-[var(--radius-md)] bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Identity"}
          </button>
        </div>
      )}
    </div>
  );
}
