import { afterEach, describe, expect, it, vi } from "vitest";

const rateFinishedTable = vi.fn();
vi.mock("./index", () => ({ getRatingsService: async () => ({ rateFinishedTable }) }));
const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));

import { rateAfterResponse } from "./after";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("rateAfterResponse", () => {
  it("schedules the rating with after() and rates the table when it runs", async () => {
    afterMock.mockImplementation(() => undefined);
    rateAfterResponse("ABC234");
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0]![0]();
    expect(rateFinishedTable).toHaveBeenCalledWith("ABC234");
  });

  it("runs the rating anyway when after() is unavailable (outside a request)", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("after was called outside a request scope");
    });
    rateAfterResponse("ABC234");
    await vi.waitFor(() => expect(rateFinishedTable).toHaveBeenCalledWith("ABC234"));
  });

  it("logs and swallows a rating failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rateFinishedTable.mockRejectedValueOnce(new Error("db down"));
    afterMock.mockImplementation(() => undefined);
    rateAfterResponse("ABC234");
    await expect(afterMock.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
