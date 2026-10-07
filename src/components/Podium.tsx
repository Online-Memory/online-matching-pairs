"use client";

import { useCountUp } from "@/lib/client/use-count-up";
import type { PlayerView } from "@/lib/protocol";

import { ordinal } from "./Scoreboard";

type Step = { place: number; rank: number; players: PlayerView[] };

/** Groups of equal rank, best first, at most three: a tie shares a step and the next group takes the next one. */
function steps(players: readonly PlayerView[]): Step[] {
  const ranked = players.filter((p): p is PlayerView & { rank: number } => p.rank !== null && p.rank <= 3);
  const ranks = [...new Set(ranked.map((p) => p.rank))].sort((a, b) => a - b).slice(0, 3);
  return ranks.map((rank, i) => ({ place: i + 1, rank, players: ranked.filter((p) => p.rank === rank) }));
}

function PodiumStep({ step }: { step: Step }) {
  // Third place rises first, so the winner is revealed last.
  const pairs = useCountUp(step.players[0]!.pairs, { durationMs: 700, delayMs: (3 - step.place) * 300 });
  return (
    <div className="podium-step" data-place={step.place} data-testid={`podium-step-${step.place}`}>
      <span className="podium-names">{step.players.map((p) => p.name).join(" & ")}</span>
      <span className="podium-pairs">{pairs}</span>
      <span className="podium-rank">{ordinal(step.rank)}</span>
    </div>
  );
}

/** Top three of a versus game. Decorative: the results table next to it states the same facts. */
export function Podium({ players }: { players: readonly PlayerView[] }) {
  if (players.length < 2) return null;
  const all = steps(players);
  const order = all.length === 3 ? [all[1]!, all[0]!, all[2]!] : all.length === 2 ? [all[1]!, all[0]!] : all;
  return (
    <div className="podium" data-testid="podium" aria-hidden="true">
      {order.map((step) => (
        <PodiumStep key={step.place} step={step} />
      ))}
    </div>
  );
}
