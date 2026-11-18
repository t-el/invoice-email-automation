/**
 * npm start            process everything in the inbox once
 * npm run watch        poll the inbox every WATCH_INTERVAL_MS (scheduled job)
 * npm run report       print the ledger, review queue and dead letters
 * tsx src/cli.ts retry-failed   move dead-lettered emails back to the inbox
 */
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { configureLogger, log } from "./logger.js";
import { buildNotifier } from "./notify.js";
import { InvoicePipeline } from "./pipeline.js";
import { buildSink } from "./sinks/index.js";
import { FolderSource, type Source } from "./sources/folder.js";
import { ImapSource } from "./sources/imap.js";
import { Store } from "./store.js";
import type { ProcessResult } from "./types.js";

const cfg = loadConfig();
configureLogger({ format: cfg.LOG_FORMAT });
const store = new Store(join(cfg.DATA_DIR, "invoices.db"));
const source: Source = cfg.SOURCE === "imap" ? new ImapSource(cfg) : new FolderSource(cfg.INBOX_DIR);
const pipeline = new InvoicePipeline({ cfg, store, sink: buildSink(cfg), notifier: buildNotifier(cfg) });

function summary(results: ProcessResult[]) {
  console.log("\n=== Run summary ===");
  for (const r of results) {
    const inv = r.invoice;
    const what = inv?.invoiceNumber ? `${inv.vendor ?? "?"} ${inv.invoiceNumber} ${inv.currency ?? ""} ${inv.total ?? ""}` : r.ref.split("/").pop();
    const extra = r.anomalies.filter((a) => a.severity !== "info").map((a) => a.code).join(",") || r.missing?.join(",") || r.error || "";
    console.log(`  ${r.status.padEnd(13)} ${String(what).padEnd(48)} ${extra}`);
  }
  const counts = results.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  console.log("  " + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", "));
}

function report() {
  console.log("\n=== Ledger ===");
  for (const i of store.invoices()) {
    console.log(`  #${i.id} ${i.status.padEnd(8)} ${i.vendor.padEnd(26)} ${i.invoiceNumber.padEnd(15)} ${i.currency} ${i.total.toFixed(2).padStart(9)}  due ${i.dueDate ?? "-"}  ${i.anomalies.filter((a) => a.severity !== "info").map((a) => a.code).join(",")}`);
  }
  console.log("\n=== Needs review ===");
  for (const r of store.reviews()) console.log(`  ${r.ref.split("/").pop()}  missing: ${r.missing.join(", ")}`);
  console.log("\n=== Dead letters ===");
  const failed = store.failed();
  if (!failed.length) console.log("  (none)");
  for (const f of failed) console.log(`  ${f.ref.split("/").pop()} (in failed/)  ${f.error}`);
}

async function main() {
  const cmd = process.argv[2] ?? "run";
  if (cmd === "run") {
    summary(await pipeline.runOnce(source));
  } else if (cmd === "watch") {
    log.info("watching inbox", { source: source.name, intervalMs: cfg.WATCH_INTERVAL_MS });
    let stopping = false;
    process.on("SIGINT", () => (stopping = true));
    process.on("SIGTERM", () => (stopping = true));
    while (!stopping) {
      const results = await pipeline.runOnce(source).catch((err) => {
        log.error("poll cycle failed", { error: String(err) }); // e.g. IMAP down: keep the loop alive
        return [];
      });
      if (results.length) summary(results);
      await new Promise((r) => setTimeout(r, cfg.WATCH_INTERVAL_MS));
    }
  } else if (cmd === "report") {
    report();
  } else if (cmd === "retry-failed") {
    if (!(source instanceof FolderSource)) throw new Error("retry-failed is for SOURCE=folder (IMAP: move mail back from Invoices/Failed)");
    const files = source.requeueFailed();
    for (const f of store.failed()) store.forgetMessage(f.id);
    console.log(`requeued ${files.length} message(s)`);
  } else {
    console.error(`unknown command ${cmd}`);
    process.exitCode = 2;
  }
  await source.close?.();
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
