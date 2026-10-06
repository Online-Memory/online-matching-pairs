import "server-only";

import { after } from "next/server";

import { getRatingsService } from "./index";

/**
 * Rates a table that just finished, after the response has gone out so players never wait on it.
 * Best effort: a failure is logged and the daily cron sweep picks the game up later.
 */
export function rateAfterResponse(code: string): void {
  const run = async () => {
    try {
      await (await getRatingsService()).rateFinishedTable(code);
    } catch (error) {
      console.error("rating after game end failed", error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
