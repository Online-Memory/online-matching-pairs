// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PALETTE_SIZE } from "@/lib/protocol";

import { ColourPicker } from "./ColourPicker";

afterEach(cleanup);

describe("ColourPicker", () => {
  it("shows every colour by name and marks the chosen one", () => {
    render(<ColourPicker label="Your colour" value={3} taken={new Set()} onPick={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(PALETTE_SIZE);
    expect(screen.getByRole("radio", { name: "Coral" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Olive" })).not.toBeChecked();
  });

  it("disables taken colours and only reports free picks", () => {
    const onPick = vi.fn();
    render(<ColourPicker label="Your colour" value={0} taken={new Set([1])} onPick={onPick} />);
    expect(screen.getByRole("radio", { name: "Brown" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Brown" }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Maroon" }));
    expect(onPick).toHaveBeenCalledWith(2);
  });
});
