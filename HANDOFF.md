# Handoff: Invoice Email Automation

## What it does
Reads invoice emails, extracts the invoice data, checks it, writes it to the ledger, and alerts on anything suspicious. Nothing is deleted: every email ends up in `processed/` or `failed/` (or the IMAP folders `Invoices/Processed` and `Invoices/Failed`).

## Where things live

| Thing | Location |
|---|---|
| Config | `.env` (documented in `.env.example`, validated at startup by zod) |
| Database | `data/invoices.db`. Tables: `invoices` (the ledger), `vendors` (known bank details), `messages` (idempotency), `reviews` |
| CSV ledger (`SINK=csv`) | `data/ledger.csv` |
| Mock alerts (`NOTIFIER=console`) | `data/alerts.log` |
| Inbox (folder mode) | `INBOX_DIR`, with `processed/` and `failed/` subfolders |

## Statuses

| Status | Meaning | Who acts |
|---|---|---|
| `booked` | Complete, passed every check | Nobody. It's in the ledger |
| `flagged` | In the ledger, but with warnings or critical anomalies | Finance approves or rejects. **Never pay a `BANK_DETAILS_CHANGED` invoice before confirming by phone with a number you already have** |
| `needs_review` | Could not read the required fields | Enter it manually, or enable the LLM extractor |
| `duplicate` | Already processed (same Message-ID, or the same vendor, number and total) | Nobody |
| `skipped` | Not an invoice | Nobody |
| `failed` | Unexpected error (corrupt file, ledger down after retries) | Run `npm run report` to read the error, fix the cause, then run `npx tsx src/cli.ts retry-failed` |

## Daily routine
1. Check Slack for flagged invoices and review requests.
2. Run `npm run report` weekly, or open the ledger.
3. If an expected vendor's IBAN legitimately changes, confirm it out of band, then update it: `sqlite3 data/invoices.db "UPDATE vendors SET iban='NEW' WHERE vendor_key='vendor-domain.com'"`.

## Tuning
- `AMOUNT_SPIKE_FACTOR` (default 3x the vendor's average) and `MAX_AUTO_APPROVE_AMOUNT`.
- To support a new invoice layout, add a regex label in `src/extract/regex.ts` and a test case in `tests/regex.test.ts`.
- To add a new rule, add it to `detectAnomalies` in `src/validate.ts` with a severity: `info` doesn't flag, `warning` and `critical` do.

## Failure playbook

| Log message | Action |
|---|---|
| `retries exhausted step=ledger_write` | Google Sheets or the disk is unavailable. Fix it, then run `retry-failed` |
| `LLM extraction failed, using regex result` | OpenAI key or quota problem. Processing continues on regex |
| `poll cycle failed` (watch mode) | IMAP login or network problem. Check the app password. The worker keeps retrying every cycle |
| `alert could not be delivered` | The Slack webhook was revoked. Invoices are still stored, so update `SLACK_WEBHOOK_URL` |

## Security
- Use an **app password** or OAuth for IMAP, never the main account password. Give the mailbox user access to the invoices mailbox only.
- `.env` and `data/` are git-ignored. Invoices contain bank details, so keep `data/` on an encrypted disk and back up `invoices.db`.
- When the LLM is enabled, invoice text is sent to the provider. Use a provider and region your client has approved, or a local model through `OPENAI_BASE_URL` (Ollama).
