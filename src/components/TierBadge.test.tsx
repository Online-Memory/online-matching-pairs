// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TierBadge } from "./TierBadge";

afterEach(cleanup);

describe("TierBadge", () => {
  it("shows the tier's name and exposes it to styling", () => {
    render(<TierBadge tier="gold" />);
    expect(screen.getByText("Gold")).toHaveAttribute("data-tier", "gold");
  });
});
