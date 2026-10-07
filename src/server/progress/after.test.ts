import { afterEach, describe, expect, it, vi } from "vitest";

const awardFinishedTable = vi.fn();
vi.mock("./index", () => ({ getProgressService: async () => ({ awardFinishedTable }) }));
const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));

import { awardAfterResponse } from "./after";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("awardAfterResponse", () => {
  it("schedules the awarding with after() and awards the table when it runs", async () => {
    afterMock.mockImplementation(() => undefined);
    awardAfterResponse("ABC234");
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0]![0]();
    expect(awardFinishedTable).toHaveBeenCalledWith("ABC234");
  });

  it("runs the awarding anyway when after() is unavailable (outside a request)", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("after was called outside a request scope");
    });
    awardAfterResponse("ABC234");
    await vi.waitFor(() => expect(awardFinishedTable).toHaveBeenCalledWith("ABC234"));
  });

  it("logs and swallows a failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    awardFinishedTable.mockRejectedValueOnce(new Error("db down"));
    afterMock.mockImplementation(() => undefined);
    awardAfterResponse("ABC234");
    await expect(afterMock.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
