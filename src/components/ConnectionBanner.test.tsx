// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/client/api-error";
import { guarded, resetConnection } from "@/lib/client/connection";

import { ConnectionBanner } from "./ConnectionBanner";

afterEach(() => resetConnection());

describe("ConnectionBanner", () => {
  it("appears while the gate is closed and disappears once a retry succeeds", async () => {
    vi.useFakeTimers();
    render(<ConnectionBanner />);
    expect(screen.queryByRole("status")).toBeNull();

    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("network", "x", 0))
      .mockResolvedValue("ok");
    const result = guarded("read", attempt);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("status").textContent).toMatch(/retrying/i);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await result;
    expect(screen.queryByRole("status")).toBeNull();
    vi.useRealTimers();
  });
});
