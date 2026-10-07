// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfettiBurst } from "./Confetti";

const ctx = { setTransform: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: reduce }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConfettiBurst", () => {
  it("starts animating after its delay", () => {
    reducedMotion(false);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    render(<ConfettiBurst x={10} y={10} count={5} delayMs={300} />);
    vi.advanceTimersByTime(299);
    expect(raf).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when the player prefers reduced motion", () => {
    reducedMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    render(<ConfettiBurst x={10} y={10} count={5} />);
    vi.advanceTimersByTime(1000);
    expect(raf).not.toHaveBeenCalled();
  });
});
