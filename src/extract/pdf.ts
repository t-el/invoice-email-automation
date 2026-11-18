import { extractText, getDocumentProxy } from "unpdf";

export async function pdfToText(content: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(content));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}
