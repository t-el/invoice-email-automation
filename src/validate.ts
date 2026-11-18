/** Completeness validation + business-rule anomaly detection. */
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import { InvoiceSchema, type Anomaly, type ExtractedInvoice, type Invoice } from "./types.js";

const REQUIRED = ["vendor", "invoiceNumber", "issueDate", "currency", "total"] as const;

export function checkComplete(x: ExtractedInvoice): { invoice?: Invoice; missing: string[] } {
  const missing: string[] = REQUIRED.filter((k) => x[k] === null || x[k] === undefined || x[k] === "");
  if (missing.length) return { missing };
  const parsed = InvoiceSchema.safeParse({
    vendor: x.vendor, invoiceNumber: x.invoiceNumber, issueDate: x.issueDate, dueDate: x.dueDate ?? null,
    currency: x.currency, subtotal: x.subtotal ?? null, tax: x.tax ?? null, total: x.total, iban: x.iban ?? null,
  });
  if (!parsed.success) return { missing: parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`) };
  return { invoice: parsed.data, missing: [] };
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export function detectAnomalies(inv: Invoice, vendorKey: string, store: Store, cfg: Config): Anomaly[] {
  const out: Anomaly[] = [];
  const money = (n: number) => `${inv.currency} ${n.toFixed(2)}`;

  if (inv.subtotal !== null && inv.tax !== null && Math.abs(inv.subtotal + inv.tax - inv.total) > 0.01) {
    out.push({ code: "TOTAL_MISMATCH", severity: "critical",
      message: `subtotal ${money(inv.subtotal)} + tax ${money(inv.tax)} != total ${money(inv.total)}` });
  }
  if (inv.dueDate) {
    const d = days(inv.issueDate, inv.dueDate);
    if (d < 0) out.push({ code: "DUE_BEFORE_ISSUE", severity: "warning", message: `due date ${inv.dueDate} is before issue date` });
    else if (d < 7) out.push({ code: "SHORT_PAYMENT_TERMS", severity: "warning", message: `only ${d} days to pay (pressure tactic?)` });
  }

  const vendor = store.vendor(vendorKey);
  if (!vendor) {
    out.push({ code: "NEW_VENDOR", severity: "info", message: `first invoice from ${inv.vendor}` });
  } else if (vendor.iban && inv.iban && vendor.iban !== inv.iban) {
    out.push({ code: "BANK_DETAILS_CHANGED", severity: "critical",
      message: `IBAN changed from ${mask(vendor.iban)} to ${mask(inv.iban)}. Verify by phone before paying (common invoice fraud).` });
  }

  const { avg, count } = store.vendorAverage(vendorKey);
  if (count >= 1 && inv.total > avg * cfg.AMOUNT_SPIKE_FACTOR) {
    out.push({ code: "AMOUNT_SPIKE", severity: "warning",
      message: `${money(inv.total)} is ${(inv.total / avg).toFixed(1)}x this vendor's average (${money(avg)})` });
  }
  if (inv.total > cfg.MAX_AUTO_APPROVE_AMOUNT) {
    out.push({ code: "HIGH_AMOUNT", severity: "warning", message: `above auto-approve limit ${cfg.MAX_AUTO_APPROVE_AMOUNT}` });
  }
  return out;
}

export const needsAttention = (a: Anomaly[]) => a.some((x) => x.severity !== "info");

export function mask(iban: string): string {
  return iban.length > 8 ? `${iban.slice(0, 4)}…${iban.slice(-4)}` : iban;
}
