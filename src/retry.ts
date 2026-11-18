import { log } from "./logger.js";

export class TransientError extends Error {
  readonly transient = true;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isTransient(err: unknown): boolean {
  if (err instanceof TransientError) return true;
  const code = (err as { code?: string })?.code;
  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code ?? "");
}

export function httpError(status: number, what: string): Error {
  const msg = `${what} HTTP ${status}`;
  return status === 429 || status >= 500 ? new TransientError(msg) : new Error(msg);
}

/** Retry transient failures with exponential backoff + jitter. Non-transient errors fail fast. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; baseDelayMs: number; step: string; sleepFn?: (ms: number) => Promise<void> },
): Promise<T> {
  const doSleep = opts.sleepFn ?? sleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err) || attempt >= opts.attempts) {
        if (isTransient(err)) log.error("retries exhausted", { step: opts.step, attempt, error: String(err) });
        throw err;
      }
      const delay = Math.min(30_000, opts.baseDelayMs * 2 ** (attempt - 1)) * (0.5 + Math.random() / 2);
      log.warn("transient failure, retrying", { step: opts.step, attempt, nextDelayMs: Math.round(delay), error: String(err) });
      await doSleep(delay);
    }
  }
}
