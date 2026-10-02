import { describe, expect, it } from "vitest";

import type { TableView } from "@/lib/protocol";

import { pollDelay } from "./use-table";

const view = (status: TableView["status"]) => ({ status }) as TableView;

describe("pollDelay", () => {
  it("polls fast while playing, slower in the lobby or in a background tab, and stops at the end", () => {
    expect(pollDelay(view("playing"), false)).toBe(1_000);
    expect(pollDelay(view("lobby"), false)).toBe(2_000);
    expect(pollDelay(null, false)).toBe(2_000);
    expect(pollDelay(view("playing"), true)).toBe(5_000);
    expect(pollDelay(view("finished"), false)).toBeNull();
    expect(pollDelay(view("abandoned"), true)).toBeNull();
    expect(pollDelay(view("playing"), false, 250)).toBe(250);
  });
});
