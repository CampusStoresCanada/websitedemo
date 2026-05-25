/**
 * QBO Chart of Accounts — fetch and index by ID.
 * Used to enrich P&L report rows with account numbers.
 */

import type { QBAccount } from "./types";

// Re-export the type so callers can import from here
export type { QBAccount };

// ─── inline qbRequest to avoid circular imports ───────────────────
// We call client.ts helpers via dynamic import to keep this file lean.
// But actually we just re-use the same pattern inline below via the
// exported fetchAccounts helper which the reports module calls.

/**
 * Fetch all active accounts from QBO.
 * Returns a map: QBO account ID → QBAccount
 */
export async function fetchAccountsMap(): Promise<Map<string, QBAccount>> {
  // Dynamic import to avoid circular dependency issues
  const { fetchQBAccounts } = await import("./client");
  const accounts = await fetchQBAccounts();
  const map = new Map<string, QBAccount>();
  for (const acct of accounts) {
    map.set(acct.Id, acct);
  }
  return map;
}

/**
 * Given an accounts map, resolve the account number for a QBO account ID.
 * Falls back to the account name if no AcctNum is set.
 */
export function resolveAccountNum(
  accountsMap: Map<string, QBAccount>,
  qboId: string
): string {
  const acct = accountsMap.get(qboId);
  return acct?.AcctNum ?? "";
}
