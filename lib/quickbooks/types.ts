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
