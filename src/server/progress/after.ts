import "server-only";

import { after } from "next/server";

import { getProgressService } from "./index";

/**
 * Awards XP for a table that just finished, after the response has gone out so players never wait on it.
 * Best effort: a failure is logged and the daily cron sweep picks the game up later.
 */
export function awardAfterResponse(code: string): void {
  const run = async () => {
    try {
      await (await getProgressService()).awardFinishedTable(code);
    } catch (error) {
      console.error("xp award after game end failed", error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
