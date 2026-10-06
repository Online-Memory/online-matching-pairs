import "server-only";

import type { LeaderboardEntry, LeaderboardResponse, LeaderboardScope, StatsResponse } from "@/lib/protocol";
import type { Db } from "@/server/db";
import {
  applyRatings,
  ensureRatingRows,
  listUnrated,
  loadGameToRate,
  loadRatings,
  loadRepeatCounts,
  markUnratable,
  queryLeaderboard,
  queryRating,
  queryStats,
  type LeaderboardRow,
} from "@/server/db/ratings";
import { ServiceError } from "@/server/tables/service";

import { computeRatings } from "./rating";

const MAX_ATTEMPTS = 5;
const DEFAULT_BOARD_SIZE = 50;

/** What ratings needs to know about friendships. `FriendsService` implements it. */
export interface FriendIds {
  friendIds(userId: string): Promise<string[]>;
}

type Options = { clock?: () => number; friends: FriendIds };

export class RatingsService {
  private readonly clock: () => number;
  private readonly friends: FriendIds;

  constructor(
    private readonly db: Db,
    options: Options,
  ) {
    this.clock = options.clock ?? Date.now;
    this.friends = options.friends;
  }

  /** Rates one finished game. True if this call applied it; false if there was nothing to do. Idempotent. */
  async rateGame(gameId: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const game = await loadGameToRate(this.db, gameId);
      if (!game) return false;

      const at = new Date(this.clock()).toISOString();
      if (game.participants.length < 2) {
        await markUnratable(this.db, gameId, at);
        return false;
      }

      const userIds = game.participants.map((p) => p.userId);
      await ensureRatingRows(this.db, userIds);
      const [current, repeats] = await Promise.all([
        loadRatings(this.db, userIds),
        loadRepeatCounts(this.db, gameId, userIds),
      ]);

      const results = computeRatings(
        game.participants.map((p) => {
          const c = current.get(p.userId)!;
          return { userId: p.userId, rank: p.rank, rating: c.rating, ratedGames: c.ratedGames };
        }),
        repeats,
      );
      const applied = await applyRatings(
        this.db,
        gameId,
        at,
        results.map((r) => {
          const c = current.get(r.userId)!;
          return {
            userId: r.userId,
            expectedVersion: c.version,
            ratingBefore: c.rating,
            ratingAfter: r.newRating,
            won: r.won,
          };
        }),
      );
      if (applied) return true;
    }
    throw new ServiceError("conflict", "Ratings are busy, try again");
  }

  async rateFinishedTable(code: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM games WHERE code = $1`, [code]);
    if (rows[0]) await this.rateGame(rows[0].id);
  }

  /** Backstop for games whose after-response rating never ran. Sequential: games share players. */
  async sweepUnrated(limit: number): Promise<{ rated: number }> {
    let rated = 0;
    for (const id of await listUnrated(this.db, limit)) {
      try {
        if (await this.rateGame(id)) rated++;
      } catch (error) {
        console.error("rating sweep failed for a game", error);
      }
    }
    return { rated };
  }

  async leaderboard(
    scope: LeaderboardScope,
    viewerId: string | null,
    limit = DEFAULT_BOARD_SIZE,
  ): Promise<LeaderboardResponse> {
    let userIds: string[] | null = null;
    if (scope === "friends") {
      if (!viewerId) throw new ServiceError("unauthorized", "Sign in to see your friends' ranking");
      userIds = [...(await this.friends.friendIds(viewerId)), viewerId];
    }
    const rows = await queryLeaderboard(this.db, { userIds, limit, meId: viewerId });
    const toEntry = (r: LeaderboardRow): LeaderboardEntry => ({
      rank: r.position,
      handle: r.handle,
      name: r.name ?? "Player",
      rating: r.rating,
      ratedGames: r.ratedGames,
      wins: r.wins,
      isYou: r.userId === viewerId,
    });
    const me = rows.find((r) => r.userId === viewerId);
    return {
      scope,
      entries: rows.filter((r) => r.position <= limit).map(toEntry),
      me: me ? toEntry(me) : null,
    };
  }

  async statsFor(userId: string): Promise<StatsResponse> {
    const [stats, rating] = await Promise.all([queryStats(this.db, userId), queryRating(this.db, userId)]);
    return {
      games: stats.games,
      versusGames: stats.versusGames,
      wins: stats.wins,
      winRate: stats.versusGames > 0 ? stats.wins / stats.versusGames : null,
      bestStreak: stats.bestStreak,
      accuracy: stats.moves > 0 ? stats.pairs / stats.moves : null,
      rating: rating ? { value: rating.rating, ratedGames: rating.ratedGames, rank: rating.position } : null,
    };
  }
}
