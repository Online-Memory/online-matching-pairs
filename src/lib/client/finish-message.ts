import type { TableView } from "@/lib/protocol";

export type FinishMessage = { title: string; detail: string; won: boolean };

const PLACES = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth"];
const place = (rank: number) => PLACES[rank] ?? `${rank}th`;
const pairsText = (n: number) => `${n} ${n === 1 ? "pair" : "pairs"}`;
const joinNames = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** What to announce when a game ends, from the viewer's side. Null until the scores are in. */
export function finishMessage(view: TableView): FinishMessage | null {
  if (view.status !== "finished") return null;
  const winners = view.players.filter((p) => p.rank === 1);
  if (winners.length === 0) return null;
  const you = view.players.find((p) => p.id === view.youId);

  if (view.players.length === 1) {
    return {
      title: "All pairs found!",
      detail: `${pairsText(view.pairs)} in ${you?.moves ?? view.players[0]!.moves} moves`,
      won: true,
    };
  }

  const winningPairs = winners[0]!.pairs;
  if (!you) {
    const names = winners.map((w) => w.name);
    return {
      title: winners.length > 1 ? `${joinNames(names)} share the win` : `${names[0]} wins!`,
      detail: `with ${pairsText(winningPairs)}`,
      won: false,
    };
  }

  if (you.rank === 1) {
    const rivals = view.players.filter((p) => p.id !== you.id);
    return winners.length > 1
      ? { title: "You share the win!", detail: `tied on ${pairsText(you.pairs)}`, won: true }
      : {
          title: "You won!",
          detail: `${pairsText(you.pairs)}, ${you.pairs - Math.max(...rivals.map((p) => p.pairs))} ahead`,
          won: true,
        };
  }

  const rank = you.rank ?? view.players.length;
  const tied = view.players.some((p) => p.id !== you.id && p.rank === rank);
  const others = joinNames(winners.map((w) => w.name));
  return {
    title: tied ? `Tied for ${place(rank).toLowerCase()} place` : `${place(rank)} place`,
    detail: `${pairsText(you.pairs)}. ${others} took the win with ${winningPairs}`,
    won: false,
  };
}
