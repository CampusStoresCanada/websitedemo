"use client";

import { useEffect, useState } from "react";

interface QBAccount {
  Id: string;
  Name: string;
  AccountType: string;
}

interface QBAccountPickerProps {
  value: string | null;
  onChange: (accountId: string | null, accountName: string | null) => void;
  label?: string;
  required?: boolean;
}

export default function QBAccountPicker({
  value,
  onChange,
  label = "QuickBooks Account",
  required = false,
}: QBAccountPickerProps) {
  const [accounts, setAccounts] = useState<QBAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadAccounts = async () => {
    if (loaded) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/qbo/accounts");
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to load QB accounts");
      }
      const data: QBAccount[] = await res.json();
      setAccounts(data);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QB accounts");
    } finally {
      setLoading(false);
    }
  };

  // Same eager-load-when-a-value-exists fix as the other QBO pickers.
  useEffect(() => {
    if (value) loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAccount = accounts.find((a) => a.Id === value);

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <select
        value={value ?? ""}
        onFocus={loadAccounts}
        onChange={(e) => {
          const selectedId = e.target.value || null;
          const selectedName = accounts.find((a) => a.Id === selectedId)?.Name ?? null;
          onChange(selectedId, selectedName);
        }}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
        required={required}
      >
        <option value="">{loading ? "Loading QB accounts…" : "— No account linked —"}</option>
        {accounts.map((account) => (
          <option key={account.Id} value={account.Id}>
            {account.Name} ({account.AccountType})
          </option>
        ))}
      </select>

      {error && (
        <p className="mt-1 text-xs text-red-600">
          {error} — check that QB integration is configured.
        </p>
      )}

      {value && selectedAccount && (
        <p className="mt-1 text-[11px] text-gray-500">
          Linked: {selectedAccount.Name} (ID: {value})
        </p>
      )}

      {value && !selectedAccount && loaded && (
        <p className="mt-1 text-[11px] text-amber-600">
          Previously linked account (ID: {value}) not found in QB — may have been deleted.
        </p>
      )}
    </div>
  );
}
