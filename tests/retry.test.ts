import { describe, expect, it } from "vitest";
import { configureLogger } from "../src/logger.js";
import { httpError, TransientError, withRetry } from "../src/retry.js";

configureLogger({ silent: true });
const noSleep = async () => {};

describe("withRetry", () => {
  it("retries transient errors with growing delays", async () => {
    const delays: number[] = [];
    let n = 0;
    const out = await withRetry(async () => { if (++n < 4) throw new TransientError("x"); return "ok"; },
      { attempts: 5, baseDelayMs: 100, step: "t", sleepFn: async (ms) => { delays.push(ms); } });
    expect(out).toBe("ok");
    expect(delays).toHaveLength(3);
    expect(delays[2]).toBeGreaterThan(delays[0]);
  });

  it("fails fast on non-transient errors", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw httpError(400, "api"); }, { attempts: 5, baseDelayMs: 0, step: "t", sleepFn: noSleep }))
      .rejects.toThrow("api HTTP 400");
    expect(n).toBe(1);
  });

  it("classifies 429 and 5xx as transient", () => {
    expect(httpError(429, "a")).toBeInstanceOf(TransientError);
    expect(httpError(502, "a")).toBeInstanceOf(TransientError);
    expect(httpError(404, "a")).not.toBeInstanceOf(TransientError);
  });
});
