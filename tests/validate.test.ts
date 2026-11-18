import { describe, expect, it } from "vitest";
import { checkComplete, detectAnomalies } from "../src/validate.js";
import { setup } from "./helpers.js";

const inv = { vendor: "Acme", invoiceNumber: "A-1", issueDate: "2026-11-01", dueDate: "2026-12-01", currency: "EUR",
  subtotal: 100, tax: 20, total: 120, iban: "FR7600001111", extractedBy: "regex" };

describe("checkComplete", () => {
  it("accepts a complete invoice", () => expect(checkComplete(inv).invoice?.total).toBe(120));
  it("lists missing fields", () => expect(checkComplete({ ...inv, total: null, currency: null }).missing).toEqual(["currency", "total"]));
});

describe("detectAnomalies", () => {
  it("flags total mismatch, short terms and high amounts", () => {
    const { store, cfg } = setup({ copySamples: false });
    const codes = detectAnomalies(checkComplete({ ...inv, total: 9000, subtotal: 100, tax: 20, dueDate: "2026-11-03" }).invoice!, "acme", store, cfg)
      .map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["TOTAL_MISMATCH", "SHORT_PAYMENT_TERMS", "HIGH_AMOUNT", "NEW_VENDOR"]));
  });

  it("flags changed bank details and amount spikes against vendor history", () => {
    const { store, cfg } = setup({ copySamples: false });
    const ok = checkComplete(inv).invoice!;
    store.insertInvoice(ok, { vendorKey: "acme", status: "booked", anomalies: [], extractedBy: "regex", emailId: "1" });
    store.learnVendor("acme", "Acme", ok.iban);
    const next = checkComplete({ ...inv, invoiceNumber: "A-2", subtotal: 500, tax: 100, total: 600, iban: "LT1200002222" }).invoice!;
    const codes = detectAnomalies(next, "acme", store, cfg).map((a) => a.code);
    expect(codes).toContain("BANK_DETAILS_CHANGED");
    expect(codes).toContain("AMOUNT_SPIKE");
    expect(codes).not.toContain("NEW_VENDOR");
  });
});
