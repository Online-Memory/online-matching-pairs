import { tierForRating } from "@/lib/client/tiers";
import type { StatsResponse } from "@/lib/protocol";

import { TierBadge } from "./TierBadge";

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

export function StatsPanel({ stats }: { stats: StatsResponse }) {
  return (
    <section className="stats" aria-labelledby="stats-heading">
      <h2 id="stats-heading">Your record</h2>
      <dl data-testid="stats">
        <div>
          <dt>Rating</dt>
          <dd>{stats.rating ? stats.rating.value : "Unrated"}</dd>
          {stats.rating && <dd className="hint">#{stats.rating.rank}</dd>}
          {stats.rating && (
            <dd>
              <TierBadge tier={tierForRating(stats.rating.value).tier} />
            </dd>
          )}
        </div>
        <div>
          <dt>Games</dt>
          <dd>{stats.games}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{stats.versusGames > 0 ? `${stats.wins} of ${stats.versusGames}` : "–"}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{percent(stats.winRate)}</dd>
        </div>
        <div>
          <dt>Best run</dt>
          <dd>{stats.bestStreak}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>{percent(stats.accuracy)}</dd>
        </div>
      </dl>
    </section>
  );
}
