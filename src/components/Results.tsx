import Link from "next/link";

import type { TableView } from "@/lib/protocol";

import { ordinal } from "./Scoreboard";

export function Results({ view }: { view: TableView }) {
  const ranked = [...view.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const winners = ranked.filter((p) => p.rank === 1);
  const youWon = winners.some((p) => p.id === view.youId);
  const headline =
    view.players.length === 1
      ? `All ${view.pairs} pairs in ${view.players[0]!.moves} moves`
      : youWon
        ? winners.length > 1
          ? "You share the win"
          : "You win"
        : winners.length > 1
          ? `${winners.map((w) => w.name).join(" and ")} share the win`
          : `${winners[0]?.name} wins`;

  return (
    <section className="results" aria-live="polite">
      <h2>{headline}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Player</th>
            <th scope="col">Pairs</th>
            <th scope="col">Moves</th>
            <th scope="col">Best run</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p) => (
            <tr key={p.id} data-seat={p.seat}>
              <td>{p.rank ? ordinal(p.rank) : "–"}</td>
              <td>
                <span className="seat-token" aria-hidden /> {p.name}
              </td>
              <td>{p.pairs}</td>
              <td>{p.moves}</td>
              <td>{p.bestStreak}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link className="button" href="/">
        Set up another table
      </Link>
    </section>
  );
}
