// QuickBooks API types — Chunk 21

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
