import { describe, expect, it } from "vitest";

import { activeCheats, cheatHeader } from "./cheats";

describe("cheat codes", () => {
  it("turns on cheatmode only for cheatmode=true", () => {
    expect(activeCheats("?cheatmode=true")).toEqual(["cheatmode"]);
    expect(activeCheats("?cheatmode=false")).toEqual([]);
    expect(activeCheats("?other=true")).toEqual([]);
    expect(activeCheats("")).toEqual([]);
  });

  it("sends the header only when a code is active", () => {
    expect(cheatHeader("?cheatmode=true")).toEqual({ "x-cheat": "cheatmode" });
    expect(cheatHeader("?x=1")).toEqual({});
  });
});
