import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TransientError } from "../src/retry.js";
import { CsvSink, type Sink } from "../src/sinks/index.js";
import type { ProcessResult } from "../src/types.js";
import { setup } from "./helpers.js";

describe("end-to-end on the sample inbox (mock mode)", () => {
  it("books, flags, skips, reviews and dead-letters the right emails", async () => {
    const { pipeline, source, store, inbox, notifier } = setup();
    const results = await pipeline.runOnce(source);
    const byFile: Record<string, ProcessResult> = Object.fromEntries(results.map((r) => [r.ref.split("/").pop(), r]));

    expect(byFile["01-acme-invoice.eml"].status).toBe("booked");
    expect(byFile["02-printworks-body.eml"]).toMatchObject({ status: "booked", invoice: { total: 350, currency: "GBP" } });
    expect(byFile["03-acme-duplicate.eml"].status).toBe("duplicate");
    expect(byFile["04-atlas-bad-totals.eml"].anomalies.map((a) => a.code)).toContain("TOTAL_MISMATCH");
    expect(byFile["05-acme-iban-changed.eml"].status).toBe("flagged");
    expect(byFile["05-acme-iban-changed.eml"].anomalies.map((a) => a.code)).toEqual(
      expect.arrayContaining(["BANK_DETAILS_CHANGED", "AMOUNT_SPIKE", "SHORT_PAYMENT_TERMS"]),
    );
    expect(byFile["06-newsletter.eml"].status).toBe("skipped");
    expect(byFile["07-scan-missing-total.eml"]).toMatchObject({ status: "needs_review" });
    expect(byFile["08-corrupt-pdf.eml"].status).toBe("failed");

    expect(store.invoices()).toHaveLength(4);
    expect(readdirSync(join(inbox, "failed"))).toEqual(["08-corrupt-pdf.eml"]);
    expect(readdirSync(join(inbox, "processed"))).toHaveLength(7);
    expect(notifier.sent.map((s) => s.level)).toEqual(expect.arrayContaining(["critical", "warning"]));
  });

  it("is idempotent: re-delivering the same emails changes nothing", async () => {
    const { pipeline, source, store, inbox } = setup();
    await pipeline.runOnce(source);
    // simulate the mail server re-delivering everything
    const { cpSync } = await import("node:fs");
    cpSync(join(inbox, "processed"), inbox, { recursive: true });
    const second = await pipeline.runOnce(source);
    expect(second.every((r) => r.status === "duplicate")).toBe(true);
    expect(store.invoices()).toHaveLength(4);
  });

  it("retries a flaky ledger and still books the invoice", async () => {
    let calls = 0;
    const flaky: Sink = { name: "flaky", write: async () => { if (++calls < 3) throw new TransientError("503"); } };
    const { pipeline, source, store } = setup({ sink: flaky });
    await pipeline.runOnce(source);
    expect(calls).toBeGreaterThan(4);
    expect(store.invoices().length).toBe(4);
  });

  it("dead-letters a message when the ledger stays down, then succeeds on retry", async () => {
    let up = false;
    const sink: Sink = { name: "down", write: async () => { if (!up) throw new TransientError("503"); } };
    const { pipeline, source, store, inbox } = setup({ sink });
    const first = await pipeline.runOnce(source);
    expect(first.filter((r) => r.status === "failed").length).toBeGreaterThanOrEqual(4);
    expect(store.invoices()).toHaveLength(0);

    up = true;
    source.requeueFailed();
    const second = await pipeline.runOnce(source);
    expect(second.filter((r) => r.status === "booked" || r.status === "flagged").length).toBe(4);
    expect(existsSync(join(inbox, "failed", "01-acme-invoice.eml"))).toBe(false);
  });

  it("writes a CSV ledger", async () => {
    const { dir } = setup({ copySamples: false });
    const sink = new CsvSink(join(dir, "ledger.csv"));
    const { pipeline, source } = setup({ sink });
    await pipeline.runOnce(source);
    const lines = readFileSync(join(dir, "ledger.csv"), "utf8").trim().split("\n");
    expect(lines[0]).toContain("invoiceNumber");
    expect(lines).toHaveLength(5);
    expect(lines.join("\n")).toContain("BANK_DETAILS_CHANGED");
  });
});

describe("optional LLM extraction", () => {
  const llmReply = (content: object) =>
    (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 })) as unknown as typeof fetch;

  it("lets the LLM fill fields regex could not find, then validates them", async () => {
    const fetchFn = llmReply({ vendor: "Bob's Plumbing", invoiceNumber: "BP-2026-031", issueDate: "2026-11-07", currency: "EUR", total: 180 });
    const { pipeline, source } = setup({ fetchFn, cfg: { OPENAI_API_KEY: "test-key" } });
    const results = await pipeline.runOnce(source);
    const bob = results.find((r) => r.ref.endsWith("07-scan-missing-total.eml"))!;
    expect(bob.status).toBe("booked");
    expect(bob.invoice?.extractedBy).toBe("llm:gpt-4o-mini+regex");
  });

  it("falls back to regex when the LLM is down", async () => {
    const fetchFn = (async () => new Response("overloaded", { status: 503 })) as unknown as typeof fetch;
    const { pipeline, source } = setup({ fetchFn, cfg: { OPENAI_API_KEY: "test-key" } });
    const results = await pipeline.runOnce(source);
    expect(results.find((r) => r.ref.endsWith("01-acme-invoice.eml"))?.invoice?.extractedBy).toBe("regex");
    expect(results.find((r) => r.ref.endsWith("07-scan-missing-total.eml"))?.status).toBe("needs_review");
  });
});
