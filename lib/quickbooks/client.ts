// QuickBooks API client — Chunk 21
// Handles OAuth2 token lifecycle and typed API calls.

import { createAdminClient } from "@/lib/supabase/admin";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import type {
  QBCustomer,
  QBCustomerInput,
  QBInvoice,
  QBInvoiceInput,
  QBPayment,
  QBPaymentInput,
  QBTokenResponse,
  QBReport,
  QBAccount,
  QBBudget,
  QBTransaction,
} from "./types";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const API_BASE_PRODUCTION = "https://quickbooks.api.intuit.com";
const APP_SETTINGS_KEY = "qbo_refresh_token";

// Module-level access token cache — valid for the lifetime of this process.
// In serverless, this resets per cold start, which is fine.
let cachedAccessToken: string | null = null;
let cacheExpiresAt: number = 0;

function getConfig() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT ?? "sandbox";

  if (!clientId || !clientSecret) {
    throw new Error("Missing QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET");
  }

  return {
    clientId,
    clientSecret,
    apiBase: environment === "production" ? API_BASE_PRODUCTION : API_BASE_SANDBOX,
  };
}

async function getConfig2() {
  const base = getConfig();
  const realmId = await getRealmId();
  return { ...base, realmId };
}

// ─────────────────────────────────────────────────────────────────
// Token management
// ─────────────────────────────────────────────────────────────────

async function getStoredRefreshToken(): Promise<string> {
  // app_settings takes precedence over env (handles rotation after OAuth)
  const db = createAdminClient();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", APP_SETTINGS_KEY)
    .single();

  if (data?.value) return data.value;

  // Fall back to env seed value
  const envToken = process.env.QUICKBOOKS_REFRESH_TOKEN;
  if (!envToken) throw new Error("QuickBooks not connected — visit /admin/board/financials to authorise");
  return envToken;
}

async function getRealmId(): Promise<string> {
  // Env var takes priority
  if (process.env.QUICKBOOKS_REALM_ID) return process.env.QUICKBOOKS_REALM_ID;

  // Fall back to value stored during OAuth callback
  const db = createAdminClient();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "qbo_realm_id")
    .single();

  if (data?.value) return data.value;
  throw new Error("QUICKBOOKS_REALM_ID not set and not found in app_settings");
}

async function persistRefreshToken(token: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("app_settings")
    .upsert({ key: APP_SETTINGS_KEY, value: token }, { onConflict: "key" });
}

async function fetchFreshAccessToken(): Promise<string> {
  const { clientId, clientSecret } = await getConfig();
  const refreshToken = await getStoredRefreshToken();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    const message = `QB token refresh failed (${res.status}): ${body}`;
    await raiseAlertIfNotOpen({
      ruleKey: "qbo_oauth_refresh_failure",
      severity: "critical",
      message: "QuickBooks OAuth refresh token has expired or been revoked. QB exports and reconciliation are blocked until credentials are renewed.",
      details: { httpStatus: res.status, responseBody: body.slice(0, 500) },
    });
    throw new Error(message);
  }

  const tokens: QBTokenResponse = await res.json();

  // Persist rotated refresh token if QB issued a new one
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    await persistRefreshToken(tokens.refresh_token);
  }

  // Seed env-value into app_settings on first successful use
  if (!refreshToken || refreshToken === process.env.QUICKBOOKS_REFRESH_TOKEN) {
    await persistRefreshToken(tokens.refresh_token ?? refreshToken);
  }

  // Cache access token (subtract 60s buffer from stated expiry)
  cachedAccessToken = tokens.access_token;
  cacheExpiresAt = Date.now() + (tokens.expires_in - 60) * 1000;

  return tokens.access_token;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cacheExpiresAt) {
    return cachedAccessToken;
  }
  return fetchFreshAccessToken();
}

// ─────────────────────────────────────────────────────────────────
// API request helper
// ─────────────────────────────────────────────────────────────────

async function qbRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const { apiBase, realmId } = await getConfig2();
  const accessToken = await getAccessToken();
  const separator = path.includes("?") ? "&" : "?";
  const url = `${apiBase}/v3/company/${realmId}${path}${separator}minorversion=65`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QB API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// Customer operations
// ─────────────────────────────────────────────────────────────────

export async function findQBCustomer(displayName: string): Promise<QBCustomer | null> {
  const escaped = displayName.replace(/'/g, "\\'");
  const query = `SELECT * FROM Customer WHERE DisplayName = '${escaped}'`;
  const res = await qbRequest<{ QueryResponse: { Customer?: QBCustomer[] } }>(
    "GET",
    `/query?query=${encodeURIComponent(query)}`
  );
  return res.QueryResponse.Customer?.[0] ?? null;
}

export async function createQBCustomer(input: QBCustomerInput): Promise<QBCustomer> {
  const res = await qbRequest<{ Customer: QBCustomer }>("POST", "/customer", input);
  return res.Customer;
}

export async function findOrCreateQBCustomer(input: QBCustomerInput): Promise<QBCustomer> {
  const existing = await findQBCustomer(input.DisplayName);
  if (existing) return existing;
  return createQBCustomer(input);
}

// ─────────────────────────────────────────────────────────────────
// Invoice operations
// ─────────────────────────────────────────────────────────────────

export async function createQBInvoice(input: QBInvoiceInput): Promise<QBInvoice> {
  const res = await qbRequest<{ Invoice: QBInvoice }>("POST", "/invoice", input);
  return res.Invoice;
}

// ─────────────────────────────────────────────────────────────────
// Payment operations
// ─────────────────────────────────────────────────────────────────

export async function createQBPayment(input: QBPaymentInput): Promise<QBPayment> {
  const res = await qbRequest<{ Payment: QBPayment }>("POST", "/payment", input);
  return res.Payment;
}

// ─────────────────────────────────────────────────────────────────
// Payment query (inbound reconciliation)
// ─────────────────────────────────────────────────────────────────

export interface QBPaymentRecord {
  Id: string;
  TotalAmt: number;
  CustomerRef: { value: string; name?: string };
  TxnDate: string;
  Line?: Array<{
    Amount: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
}

export interface QBItem {
  Id: string;
  Name: string;
  Description?: string;
  Type: string;
  Active: boolean;
  UnitPrice?: number;
}

export async function fetchQBItems(): Promise<QBItem[]> {
  const query = `SELECT * FROM Item WHERE Active = true MAXRESULTS 200`;
  const res = await qbRequest<{ QueryResponse: { Item?: QBItem[] } }>(
    "GET",
    `/query?query=${encodeURIComponent(query)}`
  );
  return res.QueryResponse.Item ?? [];
}

/**
 * Fetch QB payments settled on or after the given date (YYYY-MM-DD).
 * Returns up to 100 — caller should track last-run timestamp to keep batches small.
 */
export async function fetchQBPaymentsSince(since: string): Promise<QBPaymentRecord[]> {
  const query = `SELECT * FROM Payment WHERE TxnDate >= '${since}' MAXRESULTS 100`;
  const res = await qbRequest<{ QueryResponse: { Payment?: QBPaymentRecord[] } }>(
    "GET",
    `/query?query=${encodeURIComponent(query)}`
  );
  return res.QueryResponse.Payment ?? [];
}

// ─────────────────────────────────────────────────────────────────
// Reports API — P&L and Balance Sheet
// ─────────────────────────────────────────────────────────────────

export type QBReportType = "ProfitAndLoss" | "BalanceSheet";

export interface FetchReportOptions {
  /** YYYY-MM-DD — defaults to first day of current month */
  startDate?: string;
  /** YYYY-MM-DD — defaults to today */
  endDate?: string;
  /** "Accrual" | "Cash" — defaults to Accrual */
  accountingMethod?: "Accrual" | "Cash";
}

/**
 * Fetch a QBO report (ProfitAndLoss or BalanceSheet).
 * Uses the standard qbRequest helper — same auth, same base URL.
 */
export async function fetchQBReport(
  reportType: QBReportType,
  options: FetchReportOptions = {}
): Promise<QBReport> {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";

  const startDate        = options.startDate        ?? firstOfMonth;
  const endDate          = options.endDate          ?? today;
  const accountingMethod = options.accountingMethod ?? "Accrual";

  const params = new URLSearchParams({
    start_date:         startDate,
    end_date:           endDate,
    accounting_method:  accountingMethod,
  });

  // Reports live under /reports/<name> — qbRequest appends ?minorversion=65
  return qbRequest<QBReport>("GET", `/reports/${reportType}?${params.toString()}`);
}

// ─────────────────────────────────────────────────────────────────
// Chart of Accounts
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch all active accounts from QBO (used to map IDs → account numbers).
 */
export async function fetchQBAccounts(): Promise<QBAccount[]> {
  const query = `SELECT * FROM Account WHERE Active = true MAXRESULTS 500`;
  const res = await qbRequest<{ QueryResponse: { Account?: QBAccount[] } }>(
    "GET",
    `/query?query=${encodeURIComponent(query)}`
  );
  return res.QueryResponse.Account ?? [];
}

// ─────────────────────────────────────────────────────────────────
// Budgets
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch all budgets from QBO.
 */
export async function fetchQBBudgets(): Promise<QBBudget[]> {
  const query = `SELECT * FROM Budget MAXRESULTS 20`;
  const res = await qbRequest<{ QueryResponse: { Budget?: QBBudget[] } }>(
    "GET",
    `/query?query=${encodeURIComponent(query)}`
  );
  return res.QueryResponse.Budget ?? [];
}

// ─────────────────────────────────────────────────────────────────
// General Ledger — transaction detail for hover
// ─────────────────────────────────────────────────────────────────

export interface FetchTransactionsOptions {
  accountId:  string;   // QBO account ID
  startDate:  string;   // YYYY-MM-DD
  endDate:    string;   // YYYY-MM-DD
  accountingMethod?: "Accrual" | "Cash";
}

/**
 * Fetch individual transactions for a single account via the GeneralLedger report.
 * Used for the hover popover on income statement rows.
 */
export async function fetchQBTransactions(
  options: FetchTransactionsOptions
): Promise<QBTransaction[]> {
  const { accountId, startDate, endDate, accountingMethod = "Accrual" } = options;

  const params = new URLSearchParams({
    start_date:        startDate,
    end_date:          endDate,
    accounting_method: accountingMethod,
    account:           accountId,
  });

  const report = await qbRequest<QBReport>(
    "GET",
    `/reports/GeneralLedger?${params.toString()}`
  );

  // Parse the GeneralLedger report rows into flat transactions
  const transactions: QBTransaction[] = [];

  for (const row of report.Rows?.Row ?? []) {
    if (row.type !== "Section") continue;
    for (const inner of (row as import("./types").QBSectionRow).Rows?.Row ?? []) {
      if (inner.type !== "Data") continue;
      const cols = (inner as import("./types").QBDataRow).ColData;
      // GL report columns: Date, Transaction Type, Doc Num, Name, Memo, Amount, Balance
      const date   = cols[0]?.value ?? "";
      const type   = cols[1]?.value ?? "";
      const docNum = cols[2]?.value ?? "";
      const payee  = cols[3]?.value ?? "";
      const memo   = cols[4]?.value ?? "";
      const amount = parseFloat(cols[5]?.value ?? "0") || 0;

      if (!date || date === "Date") continue; // skip header rows

      transactions.push({ date, type, docNum, payee, memo, amount });
    }
  }

  return transactions;
}
