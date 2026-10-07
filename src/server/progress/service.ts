import "server-only";

import { evaluateAchievements } from "@/lib/progress/achievements";
import { levelForXp } from "@/lib/progress/levels";
import { computeXp } from "@/lib/progress/xp";
import type { ProgressResponse } from "@/lib/protocol";
import type { Db } from "@/server/db";
import {
  applyProgress,
  ensureProgressRows,
  grantAchievements,
  listAchievements,
  listUnawarded,
  loadGameToAward,
  loadProgress,
  markNoProgress,
  queryLifetime,
  queryXp,
} from "@/server/db/progress";
import { ServiceError } from "@/server/tables/service";

const MAX_ATTEMPTS = 5;

type Options = { clock?: () => number };

export class ProgressService {
  private readonly clock: () => number;

  constructor(
    private readonly db: Db,
    options: Options = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  /** Awards one finished game. True if this call applied it; false if there was nothing to do. Idempotent. */
  async awardGame(gameId: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const game = await loadGameToAward(this.db, gameId);
      if (!game) return false;

      const at = new Date(this.clock()).toISOString();
      if (game.participants.length === 0) {
        await markNoProgress(this.db, gameId, at);
        return false;
      }

      const userIds = game.participants.map((p) => p.userId);
      await ensureProgressRows(this.db, userIds);
      const current = await loadProgress(this.db, userIds);

      const applied = await applyProgress(
        this.db,
        gameId,
        at,
        game.participants.map((p) => {
          const c = current.get(p.userId)!;
          const gained = computeXp({
            pairs: p.pairs,
            bestStreak: p.bestStreak,
            rank: p.rank,
            players: game.seated,
          }).total;
          return { userId: p.userId, expectedVersion: c.version, gained, xpAfter: c.xp + gained };
        }),
      );
      if (applied) {
        await this.grantAchievements(gameId, userIds, at);
        return true;
      }
    }
    throw new ServiceError("conflict", "Progress is busy, try again");
  }

  /**
   * Evaluated from lifetime stats and inserted with ON CONFLICT DO NOTHING, so it is idempotent. Best
   * effort: the XP is already committed, and anything missed here is granted at the player's next game.
   */
  private async grantAchievements(gameId: string, userIds: string[], at: string) {
    for (const userId of userIds) {
      try {
        const earned = evaluateAchievements(await queryLifetime(this.db, userId));
        if (earned.length > 0) await grantAchievements(this.db, userId, earned, gameId, at);
      } catch (error) {
        console.error("achievement grant failed", error);
      }
    }
  }

  async awardFinishedTable(code: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM games WHERE code = $1`, [code]);
    if (rows[0]) await this.awardGame(rows[0].id);
  }

  /** Backstop for games whose after-response awarding never ran. Sequential: games share players. */
  async sweepUnawarded(limit: number): Promise<{ awarded: number }> {
    let awarded = 0;
    for (const id of await listUnawarded(this.db, limit)) {
      try {
        if (await this.awardGame(id)) awarded++;
      } catch (error) {
        console.error("progress sweep failed for a game", error);
      }
    }
    return { awarded };
  }

  async progressFor(userId: string): Promise<ProgressResponse> {
    const [xp, achievements] = await Promise.all([
      queryXp(this.db, userId),
      listAchievements(this.db, userId),
    ]);
    return { xp, ...levelForXp(xp), achievements };
  }
}
