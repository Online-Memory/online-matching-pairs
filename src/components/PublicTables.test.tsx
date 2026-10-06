// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";

import { PublicTables } from "./PublicTables";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entry = (over: object) => ({
  code: "ABC234",
  tableName: "Friday showdown",
  theme: "001",
  pairs: 8,
  status: "lobby" as const,
  seats: { taken: 1, max: 4 },
  hostName: "Alice",
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...over,
});

describe("PublicTables", () => {
  it("offers Join on an open lobby and Watch on a full or started table", async () => {
    vi.spyOn(api, "publicTables").mockResolvedValue({
      tables: [
        entry({ code: "OPEN22" }),
        entry({ code: "FULL22", seats: { taken: 4, max: 4 } }),
        entry({ code: "PLAY22", status: "playing" }),
      ],
    });
    render(<PublicTables />);
    expect(await screen.findByRole("link", { name: /join.*alice/i })).toHaveAttribute(
      "href",
      "/table/OPEN22",
    );
    const watch = screen.getAllByRole("link", { name: /watch/i });
    expect(watch.map((a) => a.getAttribute("href"))).toEqual(["/table/FULL22", "/table/PLAY22"]);
  });

  it("shows who created the table and how long ago", async () => {
    vi.spyOn(api, "publicTables").mockResolvedValue({ tables: [entry({})] });
    render(<PublicTables />);
    expect(await screen.findByText("Created by Alice · 5 minutes ago")).toBeInTheDocument();
  });

  it("shows the table name, or the host's name when it has none", async () => {
    vi.spyOn(api, "publicTables").mockResolvedValue({
      tables: [entry({ code: "NAMED2" }), entry({ code: "BLANK2", tableName: "" })],
    });
    render(<PublicTables />);
    expect(await screen.findByText("Friday showdown")).toBeInTheDocument();
    expect(screen.getByText("Alice's table")).toBeInTheDocument();
  });

  it("says so when nothing is public", async () => {
    vi.spyOn(api, "publicTables").mockResolvedValue({ tables: [] });
    render(<PublicTables />);
    expect(await screen.findByText(/no public tables right now/i)).toBeInTheDocument();
  });
});
