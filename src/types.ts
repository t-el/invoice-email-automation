import { z } from "zod";

export const InvoiceSchema = z.object({
  vendor: z.string().min(1),
  invoiceNumber: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  currency: z.string().length(3),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  total: z.number().positive(),
  iban: z.string().nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** Partial result from an extractor; validation decides if it is complete enough. */
export type ExtractedInvoice = { [K in keyof Invoice]?: Invoice[K] | null } & { extractedBy: string };

export interface IncomingEmail {
  id: string; // Message-ID (idempotency key)
  from: string;
  fromName: string;
  subject: string;
  date: string;
  text: string;
  attachments: { filename: string; contentType: string; content: Buffer }[];
  /** where the raw message came from (file path or IMAP uid) */
  ref: string;
}

export type Status = "booked" | "flagged" | "needs_review" | "duplicate" | "skipped" | "failed";

export interface Anomaly {
  code: "TOTAL_MISMATCH" | "DUE_BEFORE_ISSUE" | "DUPLICATE_INVOICE" | "BANK_DETAILS_CHANGED" | "AMOUNT_SPIKE" | "NEW_VENDOR" | "HIGH_AMOUNT" | "SHORT_PAYMENT_TERMS";
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface ProcessResult {
  emailId: string;
  ref: string;
  status: Status;
  invoice?: Partial<Invoice> & { extractedBy?: string };
  anomalies: Anomaly[];
  missing?: string[];
  error?: string;
}
