/** State + history in SQLite (built into Node 22+, nothing to install). */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Anomaly, Invoice, Status } from "./types.js";

export interface InvoiceRow extends Invoice {
  id: number;
  vendorKey: string;
  status: Status;
  anomalies: Anomaly[];
  extractedBy: string;
  emailId: string;
  createdAt: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, ref TEXT, status TEXT NOT NULL, error TEXT,
        processed_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor TEXT, vendor_key TEXT NOT NULL, invoice_number TEXT NOT NULL,
        issue_date TEXT, due_date TEXT, currency TEXT, subtotal REAL, tax REAL, total REAL, iban TEXT,
        status TEXT NOT NULL, anomalies TEXT NOT NULL DEFAULT '[]', extracted_by TEXT, email_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (vendor_key, invoice_number)
      );
      CREATE TABLE IF NOT EXISTS vendors (
        vendor_key TEXT PRIMARY KEY, name TEXT, iban TEXT, first_seen TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, email_id TEXT, ref TEXT, missing TEXT, partial TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  messageSeen(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM messages WHERE id = ? AND status != 'failed'").get(id) !== undefined;
  }

  markMessage(id: string, ref: string, status: Status, error?: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO messages (id, ref, status, error) VALUES (?, ?, ?, ?)")
      .run(id, ref, status, error ?? null);
  }

  findInvoice(vendorKey: string, invoiceNumber: string): InvoiceRow | undefined {
    const row = this.db.prepare("SELECT * FROM invoices WHERE vendor_key = ? AND invoice_number = ?").get(vendorKey, invoiceNumber);
    return row ? toRow(row) : undefined;
  }

  vendor(vendorKey: string): { name: string; iban: string | null } | undefined {
    return this.db.prepare("SELECT name, iban FROM vendors WHERE vendor_key = ?").get(vendorKey) as
      | { name: string; iban: string | null }
      | undefined;
  }

  vendorAverage(vendorKey: string): { avg: number; count: number } {
    const r = this.db
      .prepare("SELECT AVG(total) AS avg, COUNT(*) AS count FROM invoices WHERE vendor_key = ? AND status = 'booked'")
      .get(vendorKey) as { avg: number | null; count: number };
    return { avg: r.avg ?? 0, count: r.count };
  }

  /** Remember vendor bank details only from clean, booked invoices (never from flagged ones). */
  learnVendor(vendorKey: string, name: string, iban: string | null) {
    this.db
      .prepare(
        `INSERT INTO vendors (vendor_key, name, iban) VALUES (?, ?, ?)
         ON CONFLICT(vendor_key) DO UPDATE SET name = excluded.name, iban = COALESCE(vendors.iban, excluded.iban)`,
      )
      .run(vendorKey, name, iban);
  }

  insertInvoice(inv: Invoice, meta: { vendorKey: string; status: Status; anomalies: Anomaly[]; extractedBy: string; emailId: string }): number {
    const r = this.db
      .prepare(
        `INSERT INTO invoices (vendor, vendor_key, invoice_number, issue_date, due_date, currency, subtotal, tax, total, iban,
                               status, anomalies, extracted_by, email_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(inv.vendor, meta.vendorKey, inv.invoiceNumber, inv.issueDate, inv.dueDate, inv.currency, inv.subtotal, inv.tax,
        inv.total, inv.iban, meta.status, JSON.stringify(meta.anomalies), meta.extractedBy, meta.emailId);
    return Number(r.lastInsertRowid);
  }

  addReview(emailId: string, ref: string, missing: string[], partial: unknown) {
    this.db.prepare("INSERT INTO reviews (email_id, ref, missing, partial) VALUES (?, ?, ?, ?)")
      .run(emailId, ref, JSON.stringify(missing), JSON.stringify(partial));
  }

  invoices(): InvoiceRow[] {
    return this.db.prepare("SELECT * FROM invoices ORDER BY id").all().map(toRow);
  }

  reviews(): { email_id: string; ref: string; missing: string[] }[] {
    return (this.db.prepare("SELECT * FROM reviews ORDER BY id").all() as Record<string, string>[]).map((r) => ({
      email_id: r.email_id, ref: r.ref, missing: JSON.parse(r.missing),
    }));
  }

  failed(): { id: string; ref: string; error: string }[] {
    return this.db.prepare("SELECT id, ref, error FROM messages WHERE status = 'failed'").all() as { id: string; ref: string; error: string }[];
  }

  forgetMessage(id: string) {
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  }
}

function toRow(r: unknown): InvoiceRow {
  const x = r as Record<string, unknown>;
  return {
    id: Number(x.id), vendor: String(x.vendor), vendorKey: String(x.vendor_key), invoiceNumber: String(x.invoice_number),
    issueDate: String(x.issue_date), dueDate: (x.due_date as string) ?? null, currency: String(x.currency),
    subtotal: (x.subtotal as number) ?? null, tax: (x.tax as number) ?? null, total: Number(x.total), iban: (x.iban as string) ?? null,
    status: x.status as Status, anomalies: JSON.parse(String(x.anomalies)), extractedBy: String(x.extracted_by),
    emailId: String(x.email_id), createdAt: String(x.created_at),
  };
}
