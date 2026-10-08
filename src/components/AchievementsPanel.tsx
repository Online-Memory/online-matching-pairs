import { ACHIEVEMENTS, type AchievementId } from "@/lib/progress/achievements";

const ICONS: Record<AchievementId, string> = {
  first_game: "🎮",
  first_win: "🏆",
  win_10: "🥇",
  games_50: "🎖️",
  streak_5: "🔥",
  streak_8: "⚡",
  flawless: "💎",
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** The whole catalog, so players can see what is left to earn. Unknown ids from a newer server are ignored. */
export function AchievementsPanel({ earned }: { earned: readonly { id: string; earnedAt: string }[] }) {
  const byId = new Map(earned.map((e) => [e.id, e.earnedAt] as const));
  const count = ACHIEVEMENTS.filter((a) => byId.has(a.id)).length;
  return (
    <section className="achievements" aria-labelledby="achievements-heading">
      <h2 id="achievements-heading">Achievements</h2>
      <div className="achievement-summary">
        <p className="hint">
          {count} of {ACHIEVEMENTS.length} earned
        </p>
        <div
          className="achievement-progress"
          role="progressbar"
          aria-label="Achievements earned"
          aria-valuemin={0}
          aria-valuemax={ACHIEVEMENTS.length}
          aria-valuenow={count}
        >
          <div
            className="achievement-progress-fill"
            style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%` }}
          />
        </div>
      </div>
      <ul className="achievement-list">
        {ACHIEVEMENTS.map((a) => {
          const at = byId.get(a.id);
          return (
            <li key={a.id} className="achievement" data-earned={at !== undefined}>
              <span className="achievement-icon" aria-hidden>
                {at ? ICONS[a.id] : "🔒"}
              </span>
              <div className="achievement-body">
                <span className="achievement-title">{a.title}</span>
                <span className="achievement-desc">{a.description}</span>
                <span className="achievement-status">{at ? `Earned ${day(at)}` : "Locked"}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
