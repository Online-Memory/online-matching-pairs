// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCountUp } from "./use-count-up";

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: reduce }) });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useCountUp", () => {
  it("shows the target at once under reduced motion", () => {
    reducedMotion(true);
    const { result } = renderHook(() => useCountUp(24, { from: 0 }));
    expect(result.current).toBe(24);
  });

  it("starts at `from`, holds through the delay, then lands exactly on the target", () => {
    reducedMotion(false);
    const { result } = renderHook(() => useCountUp(1024, { from: 1000, durationMs: 800, delayMs: 200 }));
    expect(result.current).toBe(1000);
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current).toBe(1000);
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBeGreaterThan(1000);
    expect(result.current).toBeLessThan(1024);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1024);
  });

  it("counts downwards for a loss", () => {
    reducedMotion(false);
    const { result } = renderHook(() => useCountUp(976, { from: 1000, durationMs: 400 }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(976);
  });

  it("does nothing after unmount", () => {
    reducedMotion(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useCountUp(10, { durationMs: 400 }));
    unmount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
