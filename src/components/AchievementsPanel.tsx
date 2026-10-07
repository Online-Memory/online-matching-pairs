import { ACHIEVEMENTS } from "@/lib/progress/achievements";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** The whole catalog, so players can see what is left to earn. Unknown ids from a newer server are ignored. */
export function AchievementsPanel({ earned }: { earned: readonly { id: string; earnedAt: string }[] }) {
  const byId = new Map(earned.map((e) => [e.id, e.earnedAt] as const));
  const count = ACHIEVEMENTS.filter((a) => byId.has(a.id)).length;
  return (
    <section className="achievements" aria-labelledby="achievements-heading">
      <h2 id="achievements-heading">Achievements</h2>
      <p className="hint">
        {count} of {ACHIEVEMENTS.length} earned
      </p>
      <ul className="achievement-list">
        {ACHIEVEMENTS.map((a) => {
          const at = byId.get(a.id);
          return (
            <li key={a.id} className="achievement" data-earned={at !== undefined}>
              <span className="achievement-title">{a.title}</span>
              <span className="achievement-desc">{a.description}</span>
              <span className="hint">{at ? `Earned ${day(at)}` : "Locked"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
