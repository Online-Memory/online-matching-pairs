// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as hook from "@/lib/client/use-rating-change";

import { RatingChange } from "./RatingChange";

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
});
