/** Accounting destinations. The SQLite store always keeps history; the sink is where finance looks. */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "../config.js";
import { httpError, TransientError } from "../retry.js";
import type { Anomaly, Invoice, Status } from "../types.js";

export interface LedgerEntry extends Invoice {
  status: Status;
  anomalies: Anomaly[];
  emailId: string;
}

export interface Sink {
  name: string;
  write(entry: LedgerEntry): Promise<void>;
}

const COLUMNS = ["status", "vendor", "invoiceNumber", "issueDate", "dueDate", "currency", "subtotal", "tax", "total", "iban", "anomalies", "emailId"] as const;

const cell = (v: unknown) => {
  const s = Array.isArray(v) ? v.map((a: Anomaly) => a.code).join("|") : v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV ledger that opens in Excel / imports into QuickBooks, Xero, Sage. */
export class CsvSink implements Sink {
  name = "csv";
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  async write(e: LedgerEntry) {
    if (!existsSync(this.path)) appendFileSync(this.path, COLUMNS.join(",") + "\n");
    appendFileSync(this.path, COLUMNS.map((c) => cell(e[c])).join(",") + "\n");
  }
}

/** Google Sheet via an Apps Script web app (see docs/google-apps-script.js). */
export class GoogleSheetsSink implements Sink {
  name = "google_sheets";
  constructor(private url: string, private fetchFn: typeof fetch = fetch) {
    if (!url) throw new Error("GOOGLE_SHEETS_WEBHOOK_URL is required when SINK=google_sheets");
  }
  async write(e: LedgerEntry) {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(COLUMNS.map((c) => [c, cell(e[c])]))),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new TransientError(`sheets network error: ${String(err)}`);
    }
    if (!res.ok) throw httpError(res.status, "sheets");
  }
}

/** Default: nothing extra, the SQLite store's invoices table *is* the ledger. */
export class NoopSink implements Sink {
  name = "sqlite";
  async write() {}
}

export function buildSink(cfg: Config): Sink {
  if (cfg.SINK === "csv") return new CsvSink(join(cfg.DATA_DIR, "ledger.csv"));
  if (cfg.SINK === "google_sheets") return new GoogleSheetsSink(cfg.GOOGLE_SHEETS_WEBHOOK_URL);
  return new NoopSink();
}
