/**
 * email -> parse -> extract (PDF/body, regex + optional LLM) -> validate -> anomaly checks
 *       -> ledger (SQLite + optional CSV/Sheet) -> alerts
 * Idempotent per Message-ID and per (vendor, invoice number). Failures are dead-lettered, never dropped.
 */
import type { Config } from "./config.js";
import { parseEmail } from "./extract/email.js";
import { extractInvoice, type FetchLike } from "./extract/llm.js";
import { pdfToText } from "./extract/pdf.js";
import { looksLikeInvoice, regexExtract } from "./extract/regex.js";
import { log } from "./logger.js";
import type { Notifier } from "./notify.js";
import { withRetry } from "./retry.js";
import type { Sink } from "./sinks/index.js";
import type { Source } from "./sources/folder.js";
import type { Store } from "./store.js";
import type { IncomingEmail, ProcessResult } from "./types.js";
import { checkComplete, detectAnomalies, needsAttention } from "./validate.js";

export interface Deps {
  cfg: Config;
  store: Store;
  sink: Sink;
  notifier: Notifier;
  fetchFn?: FetchLike;
  sleepFn?: (ms: number) => Promise<void>;
}

const vendorKeyOf = (email: IncomingEmail) => email.from.split("@")[1]?.toLowerCase() || email.fromName.toLowerCase();

export class InvoicePipeline {
  constructor(private d: Deps) {}

  private retry<T>(fn: () => Promise<T>, step: string) {
    return withRetry(fn, { attempts: this.d.cfg.RETRY_ATTEMPTS, baseDelayMs: this.d.cfg.RETRY_BASE_DELAY_MS, step, sleepFn: this.d.sleepFn });
  }

  private async notify(title: string, lines: string[], level: "info" | "warning" | "critical") {
    try {
      await this.retry(() => this.d.notifier.send(title, lines, level), "notify");
    } catch (err) {
      // the invoice is already safely stored; an alert outage must not undo that
      log.error("alert could not be delivered", { title, error: String(err) });
    }
  }

  async textOf(email: IncomingEmail): Promise<string> {
    const parts: string[] = [];
    for (const a of email.attachments) {
      if (a.contentType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf")) {
        parts.push(await pdfToText(a.content));
      }
    }
    parts.push(email.text);
    return parts.join("\n\n");
  }

  async processEmail(email: IncomingEmail): Promise<ProcessResult> {
    const { store, sink, cfg } = this.d;
    const base = { emailId: email.id, ref: email.ref, anomalies: [] };

    if (store.messageSeen(email.id)) {
      log.info("message already processed, skipping", { emailId: email.id });
      return { ...base, status: "duplicate" };
    }

    const text = await this.textOf(email);
    if (!looksLikeInvoice(text, email.subject)) {
      store.markMessage(email.id, email.ref, "skipped");
      log.info("not an invoice, skipped", { emailId: email.id, subject: email.subject });
      return { ...base, status: "skipped" };
    }

    const extracted = await extractInvoice(text, regexExtract(text, { fromName: email.fromName }), cfg, this.d.fetchFn);
    const { invoice, missing } = checkComplete(extracted);
    if (!invoice) {
      store.addReview(email.id, email.ref, missing, extracted);
      store.markMessage(email.id, email.ref, "needs_review");
      await this.notify(`Invoice needs manual review: ${email.subject}`, [`From: ${email.fromName} <${email.from}>`, `Missing: ${missing.join(", ")}`], "warning");
      return { ...base, status: "needs_review", missing, invoice: extracted as ProcessResult["invoice"] };
    }

    const vendorKey = vendorKeyOf(email);
    const existing = store.findInvoice(vendorKey, invoice.invoiceNumber);
    if (existing && Math.abs(existing.total - invoice.total) < 0.01) {
      store.markMessage(email.id, email.ref, "duplicate");
      log.info("duplicate invoice (already in ledger), skipped", { vendorKey, invoiceNumber: invoice.invoiceNumber });
      return { ...base, status: "duplicate", invoice };
    }

    const anomalies = detectAnomalies(invoice, vendorKey, store, cfg);
    if (existing) {
      anomalies.unshift({ code: "DUPLICATE_INVOICE", severity: "critical",
        message: `invoice ${invoice.invoiceNumber} already booked with total ${existing.total}, now ${invoice.total}` });
    }
    const status = needsAttention(anomalies) ? "flagged" : "booked";

    await this.retry(() => sink.write({ ...invoice, status, anomalies, emailId: email.id }), "ledger_write");
    if (!existing) {
      store.insertInvoice(invoice, { vendorKey, status, anomalies, extractedBy: extracted.extractedBy, emailId: email.id });
    }
    if (status === "booked") store.learnVendor(vendorKey, invoice.vendor, invoice.iban);
    store.markMessage(email.id, email.ref, status);

    log.info("invoice processed", { status, vendor: invoice.vendor, invoiceNumber: invoice.invoiceNumber, total: invoice.total,
      currency: invoice.currency, anomalies: anomalies.map((a) => a.code), extractedBy: extracted.extractedBy });

    if (status === "flagged") {
      const worst = anomalies.some((a) => a.severity === "critical") ? "critical" : "warning";
      await this.notify(
        `Invoice flagged: ${invoice.vendor} ${invoice.invoiceNumber} (${invoice.currency} ${invoice.total.toFixed(2)})`,
        anomalies.filter((a) => a.severity !== "info").map((a) => `${a.code}: ${a.message}`),
        worst,
      );
    }
    return { ...base, status, anomalies, invoice: { ...invoice, extractedBy: extracted.extractedBy } };
  }

  /** One polling cycle over a source. Each message is isolated: one bad email never blocks the rest. */
  async runOnce(source: Source): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];
    for (const msg of await source.fetch()) {
      let emailId = msg.ref;
      try {
        const email = await parseEmail(msg.raw, msg.ref);
        emailId = email.id;
        const r = await this.processEmail(email);
        results.push(r);
        await source.ack(msg.ref, "done");
      } catch (err) {
        log.error("message failed, moved to dead-letter", { ref: msg.ref, error: String(err) });
        this.d.store.markMessage(emailId, msg.ref, "failed", String(err));
        await source.ack(msg.ref, "failed").catch(() => undefined);
        await this.notify("Invoice automation error", [`Message: ${msg.ref}`, `Error: ${String(err)}`], "critical");
        results.push({ emailId, ref: msg.ref, status: "failed", anomalies: [], error: String(err) });
      }
    }
    return results;
  }
}
