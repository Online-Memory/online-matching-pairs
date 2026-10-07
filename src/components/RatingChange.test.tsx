// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as hook from "@/lib/client/use-rating-change";

import { RatingChange } from "./RatingChange";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const signedIn = { authEnabled: true, user: { id: "a", name: "A", email: null, image: null } };

describe("RatingChange", () => {
  it("shows the change with its sign", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 1024 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByRole("status")).toHaveTextContent("Rating 1000 → 1024 (+24)");
  });

  it("shows a loss with a minus sign", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 976 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByRole("status")).toHaveTextContent("(−24)");
  });

  it("renders nothing, and does not look, for a guest or a solo game", () => {
    const spy = vi.spyOn(hook, "useRatingChange").mockReturnValue(null);
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const { container } = render(<RatingChange code="ABC234" versus />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).toHaveBeenCalledWith("ABC234", false);

    cleanup();
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    render(<RatingChange code="ABC234" versus={false} />);
    expect(spy).toHaveBeenLastCalledWith("ABC234", false);
  });

  it("shows the new tier's badge", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 1024 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByText("Silver")).toHaveAttribute("data-tier", "silver");
  });

  it("announces a promotion when the rating crosses into a higher tier", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1090, after: 1110 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByText("Promoted to Gold!")).toBeInTheDocument();
  });

  it.each([
    ["a demotion across a boundary", 1110, 1090],
    ["a gain inside one tier", 1000, 1050],
    ["no change", 1000, 1000],
  ])("does not announce a promotion for %s", (_name, before, after) => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before, after });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.queryByText(/Promoted/)).toBeNull();
  });

  it("starts the number at the old rating, not at zero, when motion is allowed", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 1024 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByRole("status")).toHaveTextContent("Rating 1000 → 1000");
  });
});
