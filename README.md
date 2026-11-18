# Invoice Email Automation

**Supplier invoices go straight from the inbox into your books: extracted, checked for errors and fraud, and flagged for a human only when it matters.**

![tests](https://img.shields.io/badge/vitest-30%20passing-brightgreen) ![node](https://img.shields.io/badge/node-22%2B-green) ![typescript](https://img.shields.io/badge/TypeScript-strict-blue)

## The problem

Finance teams and bookkeepers spend hours every week opening invoice emails, downloading PDFs and retyping the vendor, number, dates and amounts into a spreadsheet or accounting tool. Mistakes slip through: duplicates get paid twice, totals don't add up. And the classic **"we changed our bank details, please pay urgently"** email still gets paid.

## The solution

A TypeScript worker that watches an inbox and handles each email end to end:

1. **Collects** emails from an IMAP mailbox (Gmail, Outlook/M365, Zoho) or a folder of `.eml` files
2. **Extracts** invoice data from attached PDFs and from the email body. A deterministic parser runs first, and an **optional LLM** fills the gaps
3. **Validates** completeness and checks business rules against **vendor history**
4. **Books** clean invoices into the ledger (SQLite, a CSV for Excel, QuickBooks or Xero import, or Google Sheets)
5. **Flags** anomalies and **alerts** the team on Slack, and queues unreadable invoices for manual review
6. **Archives** each processed email. Failures move to a **dead-letter folder** and can be retried with one command

## Architecture

```mermaid
flowchart LR
    M[IMAP mailbox<br/>or .eml folder] --> P[Parse email<br/>Message-ID]
    P --> I{Already<br/>processed?}
    I -- yes --> SKIP[skip: duplicate]
    I -- no --> T[PDF text + body]
    T --> N{Looks like<br/>an invoice?}
    N -- no --> SK[skip: not an invoice]
    N -- yes --> R[Regex extractor]
    R --> L[Optional LLM extractor<br/>fills gaps, falls back on error]
    L --> V{Complete?}
    V -- no --> RV[Needs review queue + alert]
    V -- yes --> A[Anomaly checks<br/>vs vendor history]
    A --> W[(Ledger: SQLite / CSV /<br/>Google Sheets)<br/>retry + backoff]
    W --> F{Anomalies?}
    F -- yes --> AL[Slack alert: flagged]
    F -- no --> OK[booked]
    P -. exception .-> DL[dead-letter folder + alert]
```

## What it catches

| Check | Example from the sample inbox |
|---|---|
| **Bank details changed** (invoice-fraud pattern) | Acme's IBAN switches from `FR76…` to `LT12…`, with "pay urgently" in the email → **critical** |
| **Amount spike** vs the vendor's average | €9,840 is 6.8x Acme's usual €1,440 |
| **Short payment terms** (pressure tactic) | 3 days to pay |
| **Totals don't add up** | $500 + $100 tax ≠ $650 total |
| **Duplicate invoice** | The same invoice re-sent as a "reminder" is skipped. The same number with a *different* amount is flagged |
| Above the **auto-approve limit** | Configurable with `MAX_AUTO_APPROVE_AMOUNT` |
| Unreadable or incomplete invoice | Goes to the review queue with a list of what's missing (no guessing) |

## Reliability

| Risk | How it's handled |
|---|---|
| Same email delivered twice | **Idempotent** on `Message-ID` (falls back to a content hash) and on vendor plus invoice number |
| Ledger or Sheets API is down (429/5xx/network) | Exponential backoff with jitter. If it stays down, the email goes to `inbox/failed/` and an alert is sent. `retry-failed` requeues it |
| One corrupt email | Each message is isolated, so one bad PDF never blocks the rest of the batch |
| LLM hallucinates or is down | LLM output passes the **same validation and anomaly checks** as everything else. On any LLM error the regex result is used |
| Bank details learned from a fraudulent invoice | Vendor IBANs are only learned from **clean, booked** invoices, never from flagged ones |
| Alert channel down | The invoice is already stored. The failed alert is logged and doesn't roll anything back |
| IMAP outage in watch mode | The poll cycle logs the error and keeps going |
| Auditability | Structured JSON logs, plus every invoice row stores its anomalies, extraction method and source Message-ID |

## Quick start (offline, no keys)

```bash
npm install
cp .env.example .env
npm run demo        # processes the 8 sample emails end to end
npm test            # 30 tests
npm run typecheck
```

Demo summary (full output in [`docs/demo-output.txt`](docs/demo-output.txt)):

```
=== Run summary ===
  booked        Acme Cloud Hosting SAS INV-2026-1001 EUR 1440
  booked        PrintWorks Ltd PW-5521 GBP 350
  duplicate     Acme Cloud Hosting SAS INV-2026-1001 EUR 1440
  flagged       Atlas Office Supplies AT-778 USD 650             TOTAL_MISMATCH
  flagged       Acme Cloud Hosting SAS INV-2026-1102 EUR 9840    SHORT_PAYMENT_TERMS,BANK_DETAILS_CHANGED,AMOUNT_SPIKE,HIGH_AMOUNT
  skipped       06-newsletter.eml
  needs_review  Bob's Plumbing BP-2026-031                       issueDate,currency,total
  failed        08-corrupt-pdf.eml                               InvalidPDFException: Invalid PDF structure.
```

### Commands

| Command | What it does |
|---|---|
| `npm start` | Process the inbox once |
| `npm run watch` | Scheduled job: poll every `WATCH_INTERVAL_MS` (stops cleanly on SIGTERM) |
| `npm run report` | Ledger, review queue and dead letters |
| `npx tsx src/cli.ts retry-failed` | Move dead-lettered emails back into the inbox |
| `npm run samples` | Regenerate the sample `.eml` and PDF files |

### Going live

```env
SOURCE=imap
IMAP_HOST=imap.gmail.com
IMAP_USER=invoices@yourcompany.com
IMAP_PASSWORD=<app password>
OPENAI_API_KEY=sk-...                 # optional: better extraction on messy invoices
SINK=google_sheets                    # or csv
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
NOTIFIER=slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Processed mail is moved to `Invoices/Processed`, and failures go to `Invoices/Failed`. Run it with `docker compose up -d`.

## Screenshots

> Placeholders. Add these before publishing:
> - `docs/slack-alert.png`: the "bank details changed" alert in Slack
> - `docs/ledger-sheet.png`: the Google Sheet ledger with flagged rows highlighted
> - `docs/terminal-demo.png`: `npm run demo` output

## Project structure

```
src/
  pipeline.ts         orchestration (idempotency, isolation, dead-letter)
  extract/            email.ts (mailparser), pdf.ts (unpdf), regex.ts, llm.ts
  validate.ts         completeness + anomaly rules
  store.ts            SQLite (node:sqlite): messages, invoices, vendors, reviews
  sinks/              CSV, Google Sheets, SQLite ledger
  sources/            folder watcher, IMAP (imapflow)
  notify.ts, retry.ts, logger.ts, config.ts (zod-validated env), cli.ts
samples/inbox/        8 realistic sample emails (generated by scripts/make-samples.ts)
tests/                vitest: extraction, validation, retries, end to end
```

## Tech

TypeScript (strict), Node 22+ built-in SQLite, mailparser, unpdf (pdf.js), zod, imapflow, vitest, Docker.

---
Built by **Taha Elkarroumy**: reliable business automations with AI, APIs, Python and TypeScript.
