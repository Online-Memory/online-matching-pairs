// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("./auth-client", () => ({ authClient: { getSession: () => getSession() } }));

let user: { id: string } | null = { id: "u1" };
vi.mock("./use-me", () => ({ useMe: () => (user ? { authEnabled: true, user } : null) }));

import { useSessionRefresh } from "./use-session-refresh";

function Probe() {
  useSessionRefresh();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  getSession.mockResolvedValue({ data: null, error: null });
  user = { id: "u1" };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  getSession.mockReset();
});

describe("useSessionRefresh", () => {
  it("asks the auth proxy for the session on mount and then every minute", () => {
    render(<Probe />);
    expect(getSession).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("does nothing for guests", () => {
    user = null;
    render(<Probe />);
    vi.advanceTimersByTime(120_000);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("skips ticks while the tab is hidden", () => {
    render(<Probe />);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.advanceTimersByTime(60_000);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("swallows failures", async () => {
    getSession.mockRejectedValue(new Error("offline"));
    render(<Probe />);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
