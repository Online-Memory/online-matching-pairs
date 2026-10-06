// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";

import { CreateTableForm } from "./CreateTableForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const nameTable = (value = "Friday showdown") =>
  fireEvent.change(screen.getByLabelText(/table name/i), { target: { value } });

describe("CreateTableForm visibility", () => {
  it("is private by default", async () => {
    const create = vi.spyOn(api, "createTable").mockResolvedValue({ code: "ABC234" });
    render(<CreateTableForm />);
    expect(screen.getByRole("checkbox", { name: /public table/i })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /create table/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ isPublic: false })));
  });

  it("sends isPublic when the box is ticked", async () => {
    const create = vi.spyOn(api, "createTable").mockResolvedValue({ code: "ABC234" });
    render(<CreateTableForm />);
    fireEvent.click(screen.getByRole("checkbox", { name: /public table/i }));

    fireEvent.click(screen.getByRole("button", { name: /create table/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true })));
  });

  it("sends the table name trimmed, and none when it is left blank", async () => {
    const create = vi.spyOn(api, "createTable").mockResolvedValue({ code: "ABC234" });
    render(<CreateTableForm />);
    const button = screen.getByRole("button", { name: /create table/i });
    expect(button).toBeEnabled();

    nameTable("  Friday showdown  ");
    fireEvent.click(button);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ tableName: "Friday showdown" })),
    );
  });

  it("omits the table name when blank", async () => {
    const create = vi.spyOn(api, "createTable").mockResolvedValue({ code: "ABC234" });
    render(<CreateTableForm />);
    nameTable("   ");
    fireEvent.click(screen.getByRole("button", { name: /create table/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ tableName: undefined })),
    );
  });
});
