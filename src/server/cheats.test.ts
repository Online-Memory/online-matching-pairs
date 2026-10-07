import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseCheats, viewOptions } from "./cheats";

const req = (header?: string) => new Request("http://x", { headers: header ? { "x-cheat": header } : {} });

describe("parseCheats", () => {
  it("honors known codes and ignores unknown ones", () => {
    expect(parseCheats(req("cheatmode, bogus"))).toEqual(new Set(["cheatmode"]));
    expect(parseCheats(req())).toEqual(new Set());
  });

  it("reveals tiles only when cheatmode is sent", () => {
    expect(viewOptions(req("cheatmode"))).toEqual({ revealAll: true });
    expect(viewOptions(req())).toEqual({ revealAll: false });
  });
});

describe("production gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ignores the header in production unless ENABLE_CHEATS=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(viewOptions(req("cheatmode"))).toEqual({ revealAll: false });
    vi.stubEnv("ENABLE_CHEATS", "1");
    expect(viewOptions(req("cheatmode"))).toEqual({ revealAll: true });
  });

  it("is on by default outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(viewOptions(req("cheatmode"))).toEqual({ revealAll: true });
  });
});
