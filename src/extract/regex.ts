/**
 * Deterministic extractor. Handles the common invoice layouts (labels like "Invoice No",
 * "Total Due", "VAT") and both 1,234.56 and 1.234,56 number formats. Free, fast, offline.
 */
import type { ExtractedInvoice } from "../types.js";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", $: "USD" };
const CURRENCY = String.raw`(EUR|USD|GBP|MAD|CAD|CHF|€|£|\$)`;
const AMOUNT = String.raw`(-?\d+(?:[ ,.]\d{3})*(?:[.,]\d{1,2})?)`;

export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // European: 1.234,56  or 1234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Accepts 2026-11-01, 01/11/2026 (day first, EU/UK/MA style), 1 Nov 2026, Nov 1, 2026. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

const DATE = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})`;

function money(text: string, label: string): { amount: number | null; currency: string | null } {
  const re = new RegExp(String.raw`(?:^|\n)[^\n]*?${label}[^\n:]*:?\s*${CURRENCY}?\s*${AMOUNT}\s*${CURRENCY}?`, "i");
  const m = text.match(re);
  if (!m) return { amount: null, currency: null };
  const cur = m[1] ?? m[3] ?? null;
  return { amount: parseAmount(m[2]), currency: cur ? SYMBOLS[cur] ?? cur.toUpperCase() : null };
}

export function looksLikeInvoice(text: string, subject = ""): boolean {
  return /\binvoice\b|\bfacture\b|\brechnung\b/i.test(`${subject}\n${text}`);
}

export function regexExtract(text: string, hints: { fromName?: string } = {}): ExtractedInvoice {
  const num = text.match(/invoice\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i);
  const issue = text.match(new RegExp(String.raw`(?:invoice date|date of issue|issue date|(?:^|\n)date)\s*:?\s*${DATE}`, "i"));
  const due = text.match(new RegExp(String.raw`(?:due date|payment due|(?:^|\n)due)\s*:?\s*${DATE}`, "i"));
  const total = money(text, String.raw`(?<!sub)total(?:\s+due|\s+amount)?`);
  const subtotal = money(text, "subtotal");
  const tax = money(text, String.raw`(?:vat|tax|tva)`);
  const iban = text.match(/IBAN\s*:?\s*([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8})/);

  // Vendor: a line ending in a company suffix, else the sender's display name.
  const companyLine = text.split("\n").map((l) => l.trim()).find((l) => /\b(SAS|SARL|Ltd|LLC|Inc|GmbH|BV|Supplies|Hosting|Plumbing)\b\.?$/i.test(l) && l.length < 60);
  const vendor = companyLine ?? (hints.fromName || null);

  return {
    vendor,
    invoiceNumber: num?.[1] ?? null,
    issueDate: issue ? parseDate(issue[1]) : null,
    dueDate: due ? parseDate(due[1]) : null,
    currency: total.currency ?? subtotal.currency ?? null,
    subtotal: subtotal.amount,
    tax: tax.amount,
    total: total.amount,
    iban: iban ? iban[1].replace(/\s/g, "") : null,
    extractedBy: "regex",
  };
}
