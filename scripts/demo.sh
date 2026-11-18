#!/usr/bin/env bash
# End-to-end demo in mock mode: copies the 8 sample emails into a fresh inbox and processes them.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATA_DIR=${DATA_DIR:-data/demo} INBOX_DIR=${INBOX_DIR:-data/demo/inbox} LOG_FORMAT=${LOG_FORMAT:-pretty} RETRY_BASE_DELAY_MS=${RETRY_BASE_DELAY_MS:-100}
rm -rf "$DATA_DIR" && mkdir -p "$INBOX_DIR" && cp samples/inbox/*.eml "$INBOX_DIR/"

echo "### 1. Process the inbox (8 emails: clean invoices, duplicate, bad totals, IBAN fraud attempt, newsletter, unreadable scan, corrupt PDF)"
npx tsx src/cli.ts run

echo; echo "### 2. Run again: idempotent, nothing new is booked"
cp "$INBOX_DIR"/processed/01-acme-invoice.eml "$INBOX_DIR/"
npx tsx src/cli.ts run

echo; echo "### 3. Ledger, review queue and dead letters"
npx tsx src/cli.ts report

echo; echo "### 4. Alerts (mock Slack -> $DATA_DIR/alerts.log)"
cut -c1-220 "$DATA_DIR/alerts.log"
echo; echo "Demo complete. Inbox folders: $INBOX_DIR/{processed,failed}"
