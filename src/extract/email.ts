import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import type { IncomingEmail } from "../types.js";

export async function parseEmail(raw: Buffer, ref: string): Promise<IncomingEmail> {
  const m = await simpleParser(raw);
  const from = m.from?.value?.[0];
  return {
    // Fall back to a content hash when a sender omits Message-ID, so idempotency still holds.
    id: m.messageId ?? `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    from: from?.address ?? "",
    fromName: from?.name ?? "",
    subject: m.subject ?? "",
    date: (m.date ?? new Date()).toISOString(),
    text: m.text ?? "",
    attachments: m.attachments.map((a) => ({ filename: a.filename ?? "attachment", contentType: a.contentType, content: a.content })),
    ref,
  };
}
