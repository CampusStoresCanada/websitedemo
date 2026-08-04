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
  QBSalesReceipt,
  QBSalesReceiptInput,
  QBRefundReceipt,
  QBRefundReceiptInput,
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

// QBO's DocNumber field caps at 21 characters — a full UUID (36 chars) is
// rejected outright. Truncated to a prefix here; callers that need exact
// lookup should also carry the full id in PrivateNote.
export function qboDocNumber(id: string): string {
  return id.slice(0, 21);
}

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

/**
 * List every customer in the QBO company, active and inactive. QBO's query
 * API caps a single response at 1000 rows and doesn't return a total count
 * up front, so this pages with STARTPOSITION/MAXRESULTS until a short page
 * confirms the end — for a one-time reconciliation pass against Supabase
 * orgs, not a hot path.
 */
export async function listQBCustomers(): Promise<QBCustomer[]> {
  const pageSize = 1000;
  const all: QBCustomer[] = [];
  for (let startPosition = 1; ; startPosition += pageSize) {
    const query = `SELECT * FROM Customer ORDERBY Id STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
    const res = await qbRequest<{ QueryResponse: { Customer?: QBCustomer[] } }>(
      "GET",
      `/query?query=${encodeURIComponent(query)}`
    );
    const page = res.QueryResponse.Customer ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

/** Look up a QBO customer by its own ID. Returns null if deleted/inaccessible. */
export async function getQBCustomerById(id: string): Promise<QBCustomer | null> {
  try {
    const res = await qbRequest<{ Customer: QBCustomer }>("GET", `/customer/${id}`);
    return res.Customer;
  } catch {
    return null;
  }
}

/**
 * Sparse-update a QBO customer. QBO requires the current SyncToken on every
 * write (optimistic concurrency) — always fetch/pass the one from the
 * customer object you just read, never a cached one.
 */
export async function updateQBCustomer(
  id: string,
  syncToken: string,
  fields: Partial<QBCustomerInput>
): Promise<QBCustomer> {
  const res = await qbRequest<{ Customer: QBCustomer }>("POST", "/customer", {
    Id: id,
    SyncToken: syncToken,
    sparse: true,
    ...fields,
  });
  return res.Customer;
}

/**
 * Resolve the QBO customer for an org and keep its contact info current.
 *
 * Prefers the stored `knownId` (organizations.quickbooks_customer_id) over
 * a DisplayName search — matching by name alone means an org rename
 * silently spawns a second, unlinked QBO customer instead of finding the
 * existing one. Falls back to name search only when no ID is on file yet
 * (first export, or the ID was never persisted).
 *
 * Unlike the old findOrCreateQBCustomer, this doesn't just return whatever
 * it finds — if the resolved customer's PrimaryEmailAddr differs from
 * `input.PrimaryEmailAddr`, it pushes an update. QBO customer contact info
 * was previously write-once at creation time (frequently with organizations
 * .email, which is often null) and never touched again, unlike the Stripe
 * customer this mirrors (see ensureStripeCustomer in lib/stripe/billing.ts).
 */
export async function resolveQBCustomer(
  input: QBCustomerInput,
  knownId?: string | null
): Promise<QBCustomer> {
  const existing = (knownId ? await getQBCustomerById(knownId) : null) ??
    (await findQBCustomer(input.DisplayName));

  if (!existing) {
    return createQBCustomer(input);
  }

  const currentEmail = existing.PrimaryEmailAddr?.Address ?? null;
  const desiredEmail = input.PrimaryEmailAddr?.Address ?? null;
  if (desiredEmail && desiredEmail !== currentEmail) {
    return updateQBCustomer(existing.Id, existing.SyncToken, {
      PrimaryEmailAddr: input.PrimaryEmailAddr,
    });
  }

  return existing;
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
// Sales Receipt / Refund Receipt — already-paid conference commerce
// (no AR, no Invoice — Stripe already collected the money)
// ─────────────────────────────────────────────────────────────────

export async function createQBSalesReceipt(input: QBSalesReceiptInput): Promise<QBSalesReceipt> {
  const res = await qbRequest<{ SalesReceipt: QBSalesReceipt }>("POST", "/salesreceipt", input);
  return res.SalesReceipt;
}

export async function createQBRefundReceipt(input: QBRefundReceiptInput): Promise<QBRefundReceipt> {
  const res = await qbRequest<{ RefundReceipt: QBRefundReceipt }>("POST", "/refundreceipt", input);
  return res.RefundReceipt;
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

export interface QBTaxCode {
  Id: string;
  Name: string;
  Description?: string;
  Active: boolean;
}

export async function fetchQBTaxCodes(): Promise<QBTaxCode[]> {
  const query = `SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 100`;
  const res = await qbRequest<{ QueryResponse: { TaxCode?: QBTaxCode[] } }>(
    "GET",
    `/query?query=${encodeURIComponent(query)}`
  );
  return res.QueryResponse.TaxCode ?? [];
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
 *
 * GL column order varies by QBO minor version — we read the Columns header to
 * find the right indices rather than assuming fixed positions.
 * Typical columns: Date | Txn Type | No. | Name | Memo | Split | Amount | Balance
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

  // Build a ColType → index map from the report's column header
  const colTypeIndex = new Map<string, number>();
  (report.Columns?.Column ?? []).forEach((col, i) => {
    colTypeIndex.set(col.ColType, i);
  });

  // Fall back to common known positions if header isn't present
  const iDate   = colTypeIndex.get("tx_date")         ?? 0;
  const iType   = colTypeIndex.get("txn_type")         ?? 1;
  const iDocNum = colTypeIndex.get("doc_num")          ?? 2;
  const iName   = colTypeIndex.get("name")             ?? 3;
  const iMemo   = colTypeIndex.get("memo")             ?? 4;
  // "subt_nat_amount" is the net amount column in QBO GL reports
  const iAmount = colTypeIndex.get("subt_nat_amount")  ??
                  colTypeIndex.get("amount")            ?? 6;

  const transactions: QBTransaction[] = [];

  // GL report: top-level Sections are accounts; their children are Data rows
  // (sometimes with an extra intermediate Section for the account sub-group)
  function parseRows(rows: Array<import("./types").QBDataRow | import("./types").QBSectionRow>) {
    for (const row of rows) {
      if (row.type === "Data") {
        const cols   = (row as import("./types").QBDataRow).ColData;
        const date   = cols[iDate]?.value   ?? "";
        const type   = cols[iType]?.value   ?? "";
        const docNum = cols[iDocNum]?.value ?? "";
        const payee  = cols[iName]?.value   ?? "";
        const memo   = cols[iMemo]?.value   ?? "";
        const rawAmt = cols[iAmount]?.value ?? "";
        const amount = parseFloat(rawAmt);

        // Skip blank/header rows and Beginning Balance lines
        if (!date || date === "Date" || !rawAmt || isNaN(amount)) continue;

        transactions.push({ date, type, docNum, payee, memo, amount });
      } else if (row.type === "Section") {
        // Recurse — handles nested sections (e.g. sub-accounts)
        const sr = row as import("./types").QBSectionRow;
        parseRows(sr.Rows?.Row ?? []);
      }
    }
  }

  for (const row of report.Rows?.Row ?? []) {
    if (row.type !== "Section") continue;
    const sr = row as import("./types").QBSectionRow;
    parseRows(sr.Rows?.Row ?? []);
  }

  // Sort chronologically
  transactions.sort((a, b) => a.date.localeCompare(b.date));

  return transactions;
}
