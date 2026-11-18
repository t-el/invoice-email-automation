import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  DATA_DIR: z.string().default("data"),
  INBOX_DIR: z.string().default("data/inbox"),
  SOURCE: z.enum(["folder", "imap"]).default("folder"),
  IMAP_HOST: z.string().default(""),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_USER: z.string().default(""),
  IMAP_PASSWORD: z.string().default(""),
  IMAP_FOLDER: z.string().default("INBOX"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  SINK: z.enum(["sqlite", "csv", "google_sheets"]).default("sqlite"),
  GOOGLE_SHEETS_WEBHOOK_URL: z.string().default(""),
  NOTIFIER: z.enum(["console", "slack"]).default("console"),
  SLACK_WEBHOOK_URL: z.string().default(""),
  AMOUNT_SPIKE_FACTOR: z.coerce.number().default(3),
  MAX_AUTO_APPROVE_AMOUNT: z.coerce.number().default(5000),
  RETRY_ATTEMPTS: z.coerce.number().int().min(1).default(4),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(500),
  WATCH_INTERVAL_MS: z.coerce.number().default(10000),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(overrides: Partial<Record<keyof Config, string | number>> = {}): Config {
  return Env.parse({ ...process.env, ...overrides });
}
