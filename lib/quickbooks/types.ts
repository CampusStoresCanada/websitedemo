// QuickBooks API types — Chunk 21 + Board Portal

export interface QBCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
  SyncToken: string;
}

export interface QBCustomerInput {
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
}

export interface QBLineItem {
  Amount: number;
  Description?: string;
  DetailType: "SalesItemLineDetail";
  SalesItemLineDetail: {
    ItemRef: { value: string; name?: string };
    UnitPrice?: number;
    Qty?: number;
  };
}

export interface QBInvoiceInput {
  CustomerRef: { value: string };
  Line: QBLineItem[];
  TxnDate?: string;               // YYYY-MM-DD
  DueDate?: string;               // YYYY-MM-DD
  DocNumber?: string;             // our invoice ID as reference
  PrivateNote?: string;
  CurrencyRef?: { value: string };
}

export interface QBInvoice extends QBInvoiceInput {
  Id: string;
  SyncToken: string;
  TotalAmt: number;
  Balance: number;
}

export interface QBPaymentInput {
  CustomerRef: { value: string };
  TotalAmt: number;
  Line: Array<{
    Amount: number;
    LinkedTxn: Array<{ TxnId: string; TxnType: "Invoice" }>;
  }>;
  TxnDate?: string;
  CurrencyRef?: { value: string };
}

export interface QBPayment {
  Id: string;
  SyncToken: string;
  TotalAmt: number;
}

export interface QBTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

export type QBExportStatus = "pending" | "processing" | "completed" | "failed" | "retrying";

export interface QBExportQueueRow {
  id: string;
  invoice_id: string;
  qbo_invoice_id: string | null;
  qbo_payment_id: string | null;
  status: QBExportStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  lease_expires_at: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Reports API — P&L + Balance Sheet
// ─────────────────────────────────────────────────────────────────

/** A single cell in a report row or summary */
export interface QBColData {
  value: string;
  id?:   string;
}

/** A data row (leaf) in a report section */
export interface QBDataRow {
  type:    "Data";
  ColData: QBColData[];
}

/** A section row (group) — may nest further rows and has a summary */
export interface QBSectionRow {
  type:    "Section";
  group?:  string;
  Header?: { ColData: QBColData[] };
  Rows?:   { Row?: Array<QBDataRow | QBSectionRow> };
  Summary?: { ColData: QBColData[] };
}

export type QBReportRow = QBDataRow | QBSectionRow;

export interface QBReportColumn {
  ColTitle: string;
  ColType:  string;
}

export interface QBReportHeader {
  Time:        string;
  ReportName:  string;
  StartPeriod: string;
  EndPeriod:   string;
  Currency:    string;
  DateMacro?:  string;
}

/** Top-level shape returned by the QBO Reports API */
export interface QBReport {
  Header:  QBReportHeader;
  Columns: { Column: QBReportColumn[] };
  Rows:    { Row?: QBReportRow[] };
}

/** Parsed financial summary stored in board_qbo_snapshots */
export interface QBFinancialSummary {
  netIncome:          number | null;
  totalRevenue:       number | null;
  totalExpenses:      number | null;
  cashOnHand:         number | null;
  accountsReceivable: number | null;
  totalAssets:        number | null;
  periodStart:        string;       // YYYY-MM-DD
  periodEnd:          string;       // YYYY-MM-DD
  reportPulledAt:     string;       // ISO timestamp
}

export type QBReconciliationStatus = "pending_review" | "matched" | "ignored" | "failed";

// ─────────────────────────────────────────────────────────────────
// Comparative Income Statement — board financial report
// ─────────────────────────────────────────────────────────────────

/** Five data columns shown on the comparative income statement */
export interface ComparativeValues {
  priorYTD:      number | null;  // Sep 1 prior year → same month prior year
  currentYTD:    number | null;  // Sep 1 current year → report date
  priorFullYear: number | null;  // Sep 1 prior year → Aug 31 prior year
  budget:        number | null;  // full-year budget approved by BOD
  projected:     number | null;  // currentYTD + remaining budget months
  variance:      number | null;  // projected − budget
}

/** A leaf account row (e.g. "5555 · Printing & Copying") */
export interface ComparativeAccountRow {
  qboId:      string;  // QBO account ID — used for transaction hover
  accountNum: string;  // "5555"
  name:       string;  // "Printing & Copying"
  values:     ComparativeValues;
}

/** A sub-section within a segment (e.g. "Food & Beverage") — maps to QBO parent account */
export interface ComparativeSubsection {
  qboId: string;
  name:  string;
  rows:  ComparativeAccountRow[];
  total: ComparativeValues;
}

/** Top-level segment: "Governance & Operations" or "Campus Stores Conference" */
export interface ComparativeSegment {
  name:        string;
  type:        "revenue" | "expense";
  subsections: ComparativeSubsection[];
  /** Direct rows not nested under a sub-section */
  directRows:  ComparativeAccountRow[];
  total:       ComparativeValues;
}

/** Full comparative report stored in board_qbo_snapshots */
export interface ComparativeReport {
  fiscalYearStart: string;   // "2025-09-01"
  fiscalYearEnd:   string;   // "2026-08-31"
  asOfDate:        string;   // report date ("2026-04-30")
  pulledAt:        string;   // ISO timestamp
  /** Account code → QBO account ID map (used for hover lookups) */
  accountMap:      Record<string, { id: string; name: string; num: string }>;
  revenue:         ComparativeSegment[];
  expenses:        ComparativeSegment[];
  netIncome:       ComparativeValues;
  /** Balance Sheet data */
  balanceSheet:    BalanceSheetData;
}

/** Balance Sheet parsed structure */
export interface BalanceSheetSection {
  name:  string;
  rows:  Array<{ name: string; value: number | null; indent: number }>;
  total: number | null;
}

export interface BalanceSheetData {
  asOfDate:   string;
  assets:     BalanceSheetSection[];
  liabilities: BalanceSheetSection[];
  equity:     BalanceSheetSection[];
  totalAssets:      number | null;
  totalLiabilities: number | null;
  totalEquity:      number | null;
}

/** A single transaction line returned by the GeneralLedger hover API */
export interface QBTransaction {
  date:    string;   // YYYY-MM-DD
  payee:   string;
  memo:    string;
  amount:  number;
  type:    string;   // "Check", "Bill", "Journal Entry", etc.
  docNum:  string;
}

/** QBO Account entity (from Chart of Accounts query) */
export interface QBAccount {
  Id:            string;
  Name:          string;
  FullyQualifiedName: string;
  AccountType:   string;
  AccountSubType?: string;
  AcctNum?:      string;
  Active:        boolean;
  ParentRef?:    { value: string; name?: string };
  CurrentBalance?: number;
}

/** QBO Budget entity */
export interface QBBudget {
  Id:         string;
  Name:       string;
  StartDate:  string;
  EndDate:    string;
  BudgetType: string;
  BudgetDetail?: Array<{
    AccountRef:  { value: string; name?: string };
    BudgetDate:  string;   // YYYY-MM-DD (first of month)
    Amount:      number;
  }>;
}

export interface QBReconciliationQueueRow {
  id: string;
  qbo_payment_id: string;
  qbo_customer_id: string | null;
  qbo_doc_number: string | null;
  amount_cents: number;
  currency: string;
  paid_at: string | null;
  status: QBReconciliationStatus;
  matched_invoice_id: string | null;
  match_strategy: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
}
