/**
 * Generates the sample inbox: realistic .eml files, some with PDF invoices attached.
 * Run with `npm run samples`. Output is committed in samples/inbox so the demo works out of the box.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

const OUT = join(import.meta.dirname, "..", "samples", "inbox");

function pdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { CreationDate: new Date("2026-11-01T00:00:00Z") } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text(lines[0]);
    doc.moveDown();
    doc.fontSize(11);
    for (const l of lines.slice(1)) doc.text(l);
    doc.end();
  });
}

async function eml(file: string, opts: { from: string; subject: string; text: string; date: string; id: string; pdf?: { name: string; lines: string[] } }) {
  const attachments = opts.pdf ? [{ filename: opts.pdf.name, content: await pdf(opts.pdf.lines), contentType: "application/pdf" }] : [];
  const mail = new MailComposer({
    from: opts.from, to: "invoices@client-company.com", subject: opts.subject, text: opts.text,
    date: new Date(opts.date), messageId: `<${opts.id}@mail.example>`, attachments,
  });
  const raw: Buffer = await new Promise((res, rej) => mail.compile().build((e: Error | null, m: Buffer) => (e ? rej(e) : res(m))));
  writeFileSync(join(OUT, file), raw);
}

const acme = (no: string, date: string, due: string, items: [string, number][], iban: string, vat = 0.2) => {
  const sub = items.reduce((s, [, a]) => s + a, 0);
  const tax = Math.round(sub * vat * 100) / 100;
  return [
    "INVOICE", "Acme Cloud Hosting SAS", "12 Rue de la Paix, 75002 Paris, France", "",
    `Invoice Number: ${no}`, `Invoice Date: ${date}`, `Due Date: ${due}`, "Bill to: Client Company LLC", "",
    ...items.map(([d, a]) => `${d}    EUR ${a.toFixed(2)}`), "",
    `Subtotal: EUR ${sub.toFixed(2)}`, `VAT (20%): EUR ${tax.toFixed(2)}`, `Total Due: EUR ${(sub + tax).toFixed(2)}`, "",
    `Pay by bank transfer. IBAN: ${iban}`,
  ];
};

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const ACME_IBAN = "FR76 3000 6000 0112 3456 7890 189";

  await eml("01-acme-invoice.eml", {
    from: "Acme Cloud Billing <billing@acme-cloud.example>", subject: "Your invoice INV-2026-1001", date: "2026-11-02T09:00:00Z", id: "acme-1001",
    text: "Hello,\n\nPlease find attached your invoice for October.\n\nAcme Cloud Billing",
    pdf: { name: "INV-2026-1001.pdf", lines: acme("INV-2026-1001", "2026-11-01", "2026-12-01", [["Managed Kubernetes (Oct)", 900], ["Backups 500GB", 100], ["Support plan", 200]], ACME_IBAN) },
  });
  await eml("02-printworks-body.eml", {
    from: "PrintWorks Ltd <accounts@printworks.example>", subject: "Invoice PW-5521 for business cards", date: "2026-11-03T14:30:00Z", id: "pw-5521",
    text: [
      "Hi there,", "", "Thanks for your order. Invoice details below.", "",
      "Invoice No: PW-5521", "Date: 03/11/2026", "Due: 17/11/2026", "",
      "500 business cards   £250.00", "Design proof          £41.67", "",
      "Subtotal: £291.67", "VAT: £58.33", "Total: £350.00", "", "Sort code 20-00-00, IBAN: GB29 NWBK 6016 1331 9268 19", "", "PrintWorks Ltd",
    ].join("\n"),
  });
  await eml("03-acme-duplicate.eml", {
    from: "Acme Cloud Billing <billing@acme-cloud.example>", subject: "REMINDER: invoice INV-2026-1001", date: "2026-11-10T09:00:00Z", id: "acme-1001-reminder",
    text: "Friendly reminder, invoice attached again.",
    pdf: { name: "INV-2026-1001.pdf", lines: acme("INV-2026-1001", "2026-11-01", "2026-12-01", [["Managed Kubernetes (Oct)", 900], ["Backups 500GB", 100], ["Support plan", 200]], ACME_IBAN) },
  });
  await eml("04-atlas-bad-totals.eml", {
    from: "Atlas Office Supplies <invoices@atlas-office.example>", subject: "Invoice AT-778", date: "2026-11-05T08:15:00Z", id: "atlas-778",
    text: "Invoice attached.",
    pdf: { name: "AT-778.pdf", lines: [
      "TAX INVOICE", "Atlas Office Supplies", "", "Invoice #: AT-778", "Invoice Date: 2026-11-05", "Due Date: 2026-11-20", "",
      "Ergonomic chairs x2    USD 400.00", "Desk lamps x4    USD 100.00", "", "Subtotal: USD 500.00", "Tax: USD 100.00", "Total: USD 650.00",
    ] },
  });
  await eml("05-acme-iban-changed.eml", {
    from: "Acme Cloud Billing <billing@acme-cloud.example>", subject: "Invoice INV-2026-1102 - NEW BANK DETAILS", date: "2026-11-12T07:45:00Z", id: "acme-1102",
    text: "Hello, please note our bank details have changed. Kindly pay this invoice to the new account urgently.",
    pdf: { name: "INV-2026-1102.pdf", lines: acme("INV-2026-1102", "2026-11-12", "2026-11-15", [["Emergency infrastructure migration", 8000], ["Support plan", 200]], "LT12 1000 0111 0100 1000") },
  });
  await eml("06-newsletter.eml", {
    from: "SaaS Weekly <news@saasweekly.example>", subject: "5 automation trends for 2027", date: "2026-11-06T06:00:00Z", id: "news-77",
    text: "This week: AI agents, workflow tools and more. Unsubscribe anytime.",
  });
  await eml("07-scan-missing-total.eml", {
    from: "Bob's Plumbing <bob@plumbing.example>", subject: "invoice for repair", date: "2026-11-07T17:20:00Z", id: "bob-1",
    text: "Hi, invoice attached for the kitchen repair. Thanks, Bob",
    pdf: { name: "scan.pdf", lines: ["Bob's Plumbing", "", "Invoice No: BP-2026-031", "Kitchen sink repair, parts and labour", "Amount: see attached quote", "Thank you for your business"] },
  });
  // Corrupted attachment: shows the dead-letter path (message moved to inbox/failed, alert raised).
  const broken = new MailComposer({
    from: "Legacy ERP <noreply@legacy-erp.example>", to: "invoices@client-company.com", subject: "Invoice 2026-0099",
    text: "Automated invoice attached.", date: new Date("2026-11-08T03:00:00Z"), messageId: "<erp-99@mail.example>",
    attachments: [{ filename: "invoice-2026-0099.pdf", content: Buffer.from("%PDF-1.4 truncated garbage"), contentType: "application/pdf" }],
  });
  writeFileSync(join(OUT, "08-corrupt-pdf.eml"), await new Promise<Buffer>((res, rej) => broken.compile().build((e: Error | null, m: Buffer) => (e ? rej(e) : res(m)))));
  console.log(`samples written to ${OUT}`);
}

main();
