import type { ProgressResponse } from "@/lib/protocol";

/** Level and progress to the next one. Plain numbers; the bar width is the only visual. */
export function LevelBar({ progress }: { progress: ProgressResponse }) {
  const fraction = progress.xpForNext > 0 ? Math.min(1, progress.xpIntoLevel / progress.xpForNext) : 0;
  return (
    <section className="level-bar" aria-label="Level">
      <p className="level-bar-title">Level {progress.level}</p>
      <div
        className="level-bar-track"
        role="progressbar"
        aria-label="Progress to the next level"
        aria-valuemin={0}
        aria-valuenow={progress.xpIntoLevel}
        aria-valuemax={progress.xpForNext}
      >
        <div className="level-bar-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="hint">
        {progress.xpIntoLevel} / {progress.xpForNext} XP
      </p>
    </section>
  );
}
