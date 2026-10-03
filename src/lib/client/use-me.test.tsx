// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteHeader } from "@/components/SiteHeader";

import { api, ApiError } from "./api";
import { invalidateMe } from "./use-me";

vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useMe", () => {
  it("logs a failed /api/me, hides account links, and retries on the next load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const me = vi
      .spyOn(api, "me")
      .mockRejectedValueOnce(new ApiError("internal", "Something went wrong", 500))
      .mockResolvedValueOnce({ authEnabled: true, user: null });

    render(<SiteHeader />);
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining("/api/me"), expect.any(ApiError)),
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();

    invalidateMe();
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(me).toHaveBeenCalledTimes(2);
  });
});
