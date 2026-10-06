// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { guarded, isOffline, isRetryable, resetConnection } from "./connection";

const unavailable = () => new ApiError("internal", "down", 503);
const limited = (retryAfterMs?: number) => new ApiError("internal", "slow down", 429, retryAfterMs);
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(1); // no jitter reduction
  resetConnection();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isRetryable", () => {
  it("retries network failures, 429 and 502-504 only", () => {
    expect(isRetryable(new ApiError("network", "x", 0))).toBe(true);
    for (const status of [429, 502, 503, 504])
      expect(isRetryable(new ApiError("internal", "x", status))).toBe(true);
    for (const status of [400, 403, 404, 500])
      expect(isRetryable(new ApiError("internal", "x", status))).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
  });
});

describe("guarded reads", () => {
  it("passes results through without going offline", async () => {
    await expect(guarded("read", async () => 7)).resolves.toBe(7);
    expect(isOffline()).toBe(false);
  });

  it("does not retry non-retryable errors", async () => {
    const attempt = vi.fn().mockRejectedValue(new ApiError("not_found", "nope", 404));
    await expect(guarded("read", attempt)).rejects.toMatchObject({ status: 404 });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(isOffline()).toBe(false);
  });

  it("retries with exponential backoff capped at 10s, then reopens", async () => {
    const attempt = vi.fn();
    for (let i = 0; i < 6; i++) attempt.mockRejectedValueOnce(unavailable());
    attempt.mockResolvedValue("ok");
    const result = guarded("read", attempt);
    await flush();
    expect(isOffline()).toBe(true);
    for (const wait of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]) {
      const before = attempt.mock.calls.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(attempt).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempt).toHaveBeenCalledTimes(before + 1);
    }
    await expect(result).resolves.toBe("ok");
    expect(isOffline()).toBe(false);
  });

  it("honours Retry-After", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(limited(5_000)).mockResolvedValue("ok");
    const result = guarded("read", attempt);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
  });

  it("holds other reads back until the probe succeeds", async () => {
    const probe = vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValue("a");
    const other = vi.fn().mockResolvedValue("b");
    const first = guarded("read", probe);
    await flush();
    const second = guarded("read", other);
    await vi.advanceTimersByTimeAsync(500);
    expect(other).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("probes immediately when the browser comes back online", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("network", "x", 0))
      .mockResolvedValue("ok");
    const result = guarded("read", attempt);
    await flush();
    window.dispatchEvent(new Event("online"));
    await expect(result).resolves.toBe("ok");
  });
});

describe("guarded actions", () => {
  it("fails fast while offline instead of queuing", async () => {
    const probe = vi.fn().mockRejectedValue(unavailable());
    void guarded("read", probe);
    await flush();
    const action = vi.fn();
    await expect(guarded("action", action)).rejects.toMatchObject({ code: "network" });
    expect(action).not.toHaveBeenCalled();
  });

  it("is never retried, but a retryable failure closes the gate for reads", async () => {
    const action = vi.fn().mockRejectedValue(limited());
    await expect(guarded("action", action)).rejects.toMatchObject({ status: 429 });
    expect(action).toHaveBeenCalledTimes(1);
    expect(isOffline()).toBe(true);
    // The next read acts as the probe and reopens the gate.
    await expect(guarded("read", async () => "ok")).resolves.toBe("ok");
    expect(isOffline()).toBe(false);
  });
});
