ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_pdf_url text,
  ADD COLUMN IF NOT EXISTS hosted_invoice_url text;

COMMENT ON COLUMN invoices.invoice_pdf_url IS 'Stripe Invoice.invoice_pdf — captured at finalize time and again on invoice.paid, no live API call needed to render a download link.';
COMMENT ON COLUMN invoices.hosted_invoice_url IS 'Stripe Invoice.hosted_invoice_url — same capture points as invoice_pdf_url.';
