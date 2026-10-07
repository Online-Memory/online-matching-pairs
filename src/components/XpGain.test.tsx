// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as hook from "@/lib/client/use-xp-gain";

import { XpGain } from "./XpGain";

const signedIn = { authEnabled: true, user: { id: "a", name: "A", email: null, image: null } };

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("XpGain", () => {
  it("shows the XP gained and the level", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue({ gained: 50, after: 150, achievements: [] });
    render(<XpGain code="ABC234" />);
    expect(screen.getByRole("status")).toHaveTextContent("+50 XP");
    expect(screen.getByRole("status")).toHaveTextContent("Level 2");
    expect(screen.queryByText(/Level up/)).toBeNull(); // 100 XP before: already level 2
  });

  it("announces a level up when the gain crosses a level", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue({ gained: 60, after: 130, achievements: [] }); // 70 before: level 1
    render(<XpGain code="ABC234" />);
    expect(screen.getByText("Level up! You reached level 2")).toBeInTheDocument();
  });

  it("lists the achievements this game earned, by title, skipping unknown ids", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue({
      gained: 50,
      after: 150,
      achievements: ["first_win", "from_the_future"],
    });
    render(<XpGain code="ABC234" />);
    expect(screen.getByText("First win")).toBeInTheDocument();
    expect(screen.queryByText("from_the_future")).toBeNull();
  });

  it("renders nothing for a guest, and looks only for a signed-in player", () => {
    const spy = vi.spyOn(hook, "useXpGain").mockReturnValue(null);
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const { container } = render(<XpGain code="ABC234" />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).toHaveBeenCalledWith("ABC234", false);
  });

  it("renders nothing while the gain is unknown", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue(null);
    const { container } = render(<XpGain code="ABC234" />);
    expect(container).toBeEmptyDOMElement();
  });
});
