/**
 * Optional LLM extraction via any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, Ollama...).
 * The model only fills a strict JSON shape; the result is merged with the regex result and then
 * validated like everything else, so a hallucinated field can never bypass the checks.
 */
import type { Config } from "../config.js";
import { log } from "../logger.js";
import { httpError, withRetry } from "../retry.js";
import type { ExtractedInvoice } from "../types.js";

const PROMPT = `Extract the invoice from the text. Reply ONLY with JSON:
{"vendor": string|null, "invoiceNumber": string|null, "issueDate": "YYYY-MM-DD"|null, "dueDate": "YYYY-MM-DD"|null,
 "currency": "ISO 4217 code"|null, "subtotal": number|null, "tax": number|null, "total": number|null, "iban": string|null}
Use null when a value is not present. Never guess amounts.`;

export type FetchLike = typeof fetch;

export async function llmExtract(text: string, cfg: Config, fetchFn: FetchLike = fetch): Promise<ExtractedInvoice> {
  const call = async () => {
    const res = await fetchFn(`${cfg.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: cfg.OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: PROMPT }, { role: "user", content: text.slice(0, 12000) }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw httpError(res.status, "LLM");
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(body.choices[0].message.content) as Record<string, unknown>;
  };
  const data = await withRetry(call, { attempts: cfg.RETRY_ATTEMPTS, baseDelayMs: cfg.RETRY_BASE_DELAY_MS, step: "llm_extract" });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    vendor: str(data.vendor),
    invoiceNumber: str(data.invoiceNumber),
    issueDate: str(data.issueDate),
    dueDate: str(data.dueDate),
    currency: str(data.currency)?.toUpperCase() ?? null,
    subtotal: num(data.subtotal),
    tax: num(data.tax),
    total: num(data.total),
    iban: str(data.iban)?.replace(/\s/g, "") ?? null,
    extractedBy: `llm:${cfg.OPENAI_MODEL}`,
  };
}

/** LLM first when configured, regex fills gaps; any LLM failure falls back to regex only. */
export async function extractInvoice(
  text: string,
  regexResult: ExtractedInvoice,
  cfg: Config,
  fetchFn: FetchLike = fetch,
): Promise<ExtractedInvoice> {
  if (!cfg.OPENAI_API_KEY) return regexResult;
  try {
    const ai = await llmExtract(text, cfg, fetchFn);
    const merged: ExtractedInvoice = { ...regexResult, extractedBy: `${ai.extractedBy}+regex` };
    for (const [k, v] of Object.entries(ai)) {
      if (k !== "extractedBy" && v !== null && v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
    return merged;
  } catch (err) {
    log.warn("LLM extraction failed, using regex result", { error: String(err) });
    return regexResult;
  }
}
