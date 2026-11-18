/** IMAP source (Gmail, Outlook/M365, Zoho...). Reads unseen mail, then marks it seen and files it. */
import { ImapFlow } from "imapflow";
import type { Config } from "../config.js";
import type { RawMessage, Source } from "./folder.js";

export class ImapSource implements Source {
  name = "imap";
  private client: ImapFlow;
  private connected = false;

  constructor(private cfg: Config) {
    if (!cfg.IMAP_HOST || !cfg.IMAP_USER) throw new Error("IMAP_HOST and IMAP_USER are required when SOURCE=imap");
    this.client = new ImapFlow({
      host: cfg.IMAP_HOST, port: cfg.IMAP_PORT, secure: true,
      auth: { user: cfg.IMAP_USER, pass: cfg.IMAP_PASSWORD }, logger: false,
    });
  }

  private async connect() {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async fetch(): Promise<RawMessage[]> {
    await this.connect();
    const lock = await this.client.getMailboxLock(this.cfg.IMAP_FOLDER);
    try {
      const out: RawMessage[] = [];
      for await (const msg of this.client.fetch({ seen: false }, { source: true, uid: true })) {
        if (msg.source) out.push({ raw: msg.source, ref: `imap:${msg.uid}` });
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async ack(ref: string, outcome: "done" | "failed") {
    const uid = ref.replace("imap:", "");
    const lock = await this.client.getMailboxLock(this.cfg.IMAP_FOLDER);
    try {
      await this.client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      const target = outcome === "done" ? "Invoices/Processed" : "Invoices/Failed";
      await this.client.mailboxCreate(target).catch(() => undefined); // exists already: fine
      await this.client.messageMove(uid, target, { uid: true });
    } finally {
      lock.release();
    }
  }

  async close() {
    if (this.connected) await this.client.logout();
  }
}
