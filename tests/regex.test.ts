import { describe, expect, it } from "vitest";
import { looksLikeInvoice, parseAmount, parseDate, regexExtract } from "../src/extract/regex.js";

describe("parseAmount", () => {
  it.each([
    ["1440.00", 1440], ["1,440.00", 1440], ["1.440,00", 1440], ["1 440,50", 1440.5], ["350", 350], ["41.67", 41.67],
  ])("%s -> %d", (raw, expected) => expect(parseAmount(raw)).toBe(expected));
});

describe("parseDate", () => {
  it.each([
    ["2026-11-01", "2026-11-01"], ["03/11/2026", "2026-11-03"], ["3.11.2026", "2026-11-03"],
    ["1 Nov 2026", "2026-11-01"], ["November 5, 2026", "2026-11-05"], ["garbage", null],
  ])("%s -> %s", (raw, expected) => expect(parseDate(raw)).toBe(expected));
});

describe("regexExtract", () => {
  it("reads a typical PDF invoice", () => {
    const text = `INVOICE\nAcme Cloud Hosting SAS\nInvoice Number: INV-1\nInvoice Date: 2026-11-01\nDue Date: 2026-12-01\nSubtotal: EUR 1,200.00\nVAT (20%): EUR 240.00\nTotal Due: EUR 1,440.00\nIBAN: FR76 3000 6000 0112 3456 7890 189`;
    expect(regexExtract(text)).toMatchObject({
      vendor: "Acme Cloud Hosting SAS", invoiceNumber: "INV-1", issueDate: "2026-11-01", dueDate: "2026-12-01",
      currency: "EUR", subtotal: 1200, tax: 240, total: 1440, iban: "FR7630006000011234567890189",
    });
  });

  it("does not confuse Subtotal with Total and maps currency symbols", () => {
    const r = regexExtract("Invoice No: PW-1\nDate: 03/11/2026\nSubtotal: £291.67\nVAT: £58.33\nTotal: £350.00", { fromName: "PrintWorks" });
    expect(r).toMatchObject({ total: 350, subtotal: 291.67, tax: 58.33, currency: "GBP", vendor: "PrintWorks" });
  });

  it("returns nulls rather than guessing", () => {
    const r = regexExtract("Invoice No: BP-1\nAmount: see attached quote");
    expect(r.total).toBeNull();
    expect(r.currency).toBeNull();
  });

  it("detects invoice-like emails", () => {
    expect(looksLikeInvoice("hello", "Your invoice INV-1")).toBe(true);
    expect(looksLikeInvoice("weekly newsletter", "5 trends")).toBe(false);
  });
});
