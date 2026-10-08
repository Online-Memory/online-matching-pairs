// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";

import { ProfileColours } from "./ProfileColours";

beforeEach(() => {
  vi.spyOn(api, "colours").mockResolvedValue({ colours: [3] });
  vi.spyOn(api, "setColours").mockImplementation(async (colours) => ({ colours }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileColours", () => {
  it("shows three ranked slots with the saved choices", async () => {
    render(<ProfileColours />);
    expect(await screen.findByRole("button", { name: /1st choice: Coral/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2nd choice: none/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3rd choice: none/i })).toBeInTheDocument();
  });

  it("saves a pick for the selected slot and shows it", async () => {
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    await waitFor(() => expect(api.setColours).toHaveBeenCalledWith([3, 10]));
    expect(await screen.findByRole("button", { name: /2nd choice: Navy/ })).toBeInTheDocument();
  });

  it("does not let one colour fill two slots", async () => {
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    expect(screen.getByRole("radio", { name: "Coral" })).toBeDisabled();
  });

  it("clears a slot and closes the gap", async () => {
    vi.mocked(api.colours).mockResolvedValue({ colours: [3, 10] });
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear 1st choice" }));
    await waitFor(() => expect(api.setColours).toHaveBeenCalledWith([10]));
  });

  it("puts the old choices back and says so when saving fails", async () => {
    vi.mocked(api.setColours).mockRejectedValue(new Error("nope"));
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t save/i);
    expect(screen.getByRole("button", { name: /2nd choice: none/i })).toBeInTheDocument();
  });

  it("keeps the picker on the right slot when an earlier slot is cleared", async () => {
    vi.mocked(api.colours).mockResolvedValue({ colours: [3, 10] });
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /3rd choice: none/i }));
    fireEvent.click(screen.getByRole("button", { name: "Clear 1st choice" }));
    await waitFor(() => expect(api.setColours).toHaveBeenCalledWith([10]));
    // Picking now must not send a gap such as [10, null, 5].
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Moss" }));
    await waitFor(() => expect(api.setColours).toHaveBeenLastCalledWith([10, 15]));
  });

  it("does not offer editable slots, and never saves, when the saved colours can't be loaded", async () => {
    vi.mocked(api.colours).mockRejectedValue(new Error("offline"));
    render(<ProfileColours />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByRole("button", { name: /choice/i })).toBeNull();
    expect(api.setColours).not.toHaveBeenCalled();
  });

  it("offers a retry after a failed load", async () => {
    vi.mocked(api.colours)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ colours: [3] });
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("button", { name: /1st choice: Coral/ })).toBeInTheDocument();
  });
});
