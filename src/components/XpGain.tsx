"use client";

import { useEffect, useRef, useState } from "react";

import { useCountUp } from "@/lib/client/use-count-up";
import { useMe } from "@/lib/client/use-me";
import { useXpGain, type XpGain as Gain } from "@/lib/client/use-xp-gain";
import { achievementById } from "@/lib/progress/achievements";
import { levelForXp } from "@/lib/progress/levels";

import { ConfettiBurst } from "./Confetti";

const COUNT_MS = 800;

/** Its own component so the count-up mounts only once the gain is known, and starts from 0. */
function XpLine({ gain }: { gain: Gain }) {
  const shown = useCountUp(gain.gained, { from: 0, durationMs: COUNT_MS });
  const level = levelForXp(gain.after).level;
  const levelUp = level > levelForXp(gain.after - gain.gained).level;

  const bannerRef = useRef<HTMLParagraphElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!levelUp) return;
    const box = bannerRef.current?.getBoundingClientRect();
    if (box) setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, [levelUp]);

  return (
    <>
      <p className="xp-gain" role="status">
        +{shown} XP · Level {level}
      </p>
      {levelUp && (
        <p className="level-up" ref={bannerRef}>
          Level up! You reached level {level}
        </p>
      )}
      {gain.achievements.length > 0 && (
        <ul className="achievement-chips" aria-label="Achievements earned">
          {gain.achievements.flatMap((id) => {
            const a = achievementById(id);
            return a ? [<li key={id}>{a.title}</li>] : [];
          })}
        </ul>
      )}
      {levelUp && origin && <ConfettiBurst x={origin.x} y={origin.y} count={60} delayMs={COUNT_MS} />}
    </>
  );
}

/** "+125 XP · Level 3" once the server has awarded the game. Nothing for guests or while unknown. */
export function XpGain({ code }: { code: string }) {
  const me = useMe();
  const gain = useXpGain(code, Boolean(me?.user));
  return gain ? <XpLine gain={gain} /> : null;
}
