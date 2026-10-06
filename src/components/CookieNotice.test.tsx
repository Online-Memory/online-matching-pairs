// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { run } = vi.hoisted(() => ({ run: vi.fn().mockResolvedValue(undefined) }));
vi.mock("vanilla-cookieconsent", () => ({ run }));
vi.mock("vanilla-cookieconsent/dist/cookieconsent.css", () => ({}));

import { CookieNotice } from "./CookieNotice";

describe("CookieNotice", () => {
  it("starts the consent library once, even if it mounts twice", () => {
    render(<CookieNotice />).unmount();
    render(<CookieNotice />);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].categories.necessary).toEqual({ enabled: true, readOnly: true });
  });
});
