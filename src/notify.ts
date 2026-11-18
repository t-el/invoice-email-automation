import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { log } from "./logger.js";
import { httpError, TransientError } from "./retry.js";

export interface Notifier {
  name: string;
  send(title: string, lines: string[], level: "info" | "warning" | "critical"): Promise<void>;
}

/** Mock channel: logs and appends to data/alerts.log. */
export class ConsoleNotifier implements Notifier {
  name = "console";
  sent: { title: string; lines: string[]; level: string }[] = [];
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  async send(title: string, lines: string[], level: "info" | "warning" | "critical") {
    this.sent.push({ title, lines, level });
    appendFileSync(join(this.dir, "alerts.log"), JSON.stringify({ ts: new Date().toISOString(), level, title, lines }) + "\n");
    log.info("alert sent", { channel: "console", level, title });
  }
}

export class SlackNotifier implements Notifier {
  name = "slack";
  constructor(private url: string, private fetchFn: typeof fetch = fetch) {
    if (!url) throw new Error("SLACK_WEBHOOK_URL is required when NOTIFIER=slack");
  }
  async send(title: string, lines: string[], level: "info" | "warning" | "critical") {
    const icon = { info: ":information_source:", warning: ":warning:", critical: ":rotating_light:" }[level];
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `${icon} *${title}*\n${lines.map((l) => `• ${l}`).join("\n")}` }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new TransientError(`slack network error: ${String(err)}`);
    }
    if (!res.ok) throw httpError(res.status, "slack");
  }
}

export function buildNotifier(cfg: Config): Notifier {
  return cfg.NOTIFIER === "slack" ? new SlackNotifier(cfg.SLACK_WEBHOOK_URL) : new ConsoleNotifier(cfg.DATA_DIR);
}
