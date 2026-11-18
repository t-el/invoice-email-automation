import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.js";
import { configureLogger } from "../src/logger.js";
import { ConsoleNotifier } from "../src/notify.js";
import { InvoicePipeline } from "../src/pipeline.js";
import { NoopSink, type Sink } from "../src/sinks/index.js";
import { FolderSource } from "../src/sources/folder.js";
import { Store } from "../src/store.js";

configureLogger({ silent: true });

export const SAMPLES = join(import.meta.dirname, "..", "samples", "inbox");

export function setup(opts: { sink?: Sink; cfg?: Partial<Config>; fetchFn?: typeof fetch; copySamples?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "invoice-test-"));
  const inbox = join(dir, "inbox");
  if (opts.copySamples !== false) cpSync(SAMPLES, inbox, { recursive: true });
  const cfg = { ...loadConfig({ DATA_DIR: dir, INBOX_DIR: inbox, OPENAI_API_KEY: "" }), RETRY_BASE_DELAY_MS: 0, ...opts.cfg };
  const store = new Store(join(dir, "invoices.db"));
  const notifier = new ConsoleNotifier(dir);
  const source = new FolderSource(inbox);
  const pipeline = new InvoicePipeline({ cfg, store, sink: opts.sink ?? new NoopSink(), notifier, fetchFn: opts.fetchFn, sleepFn: async () => {} });
  return { dir, inbox, cfg, store, notifier, source, pipeline };
}
