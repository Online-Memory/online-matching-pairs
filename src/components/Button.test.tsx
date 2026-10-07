// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePending } from "@/lib/client/use-pending";

import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("is disabled and busy while pending, and still shows its label", () => {
    const onClick = vi.fn();
    render(
      <Button pending onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("usePending", () => {
  it("drops a second call with the same key while the first is in flight", async () => {
    const { result } = renderHook(() => usePending());
    let finish!: () => void;
    const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));

    let first!: Promise<unknown>;
    await act(async () => {
      first = result.current.run("save", action);
      await result.current.run("save", action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.isPending("save")).toBe(true);

    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.isPending("save")).toBe(false);
  });
});
