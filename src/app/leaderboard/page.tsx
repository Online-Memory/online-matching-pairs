import { Leaderboard } from "@/components/Leaderboard";

export const metadata = { title: "Leaderboard · Matching Pairs" };

export default function LeaderboardPage() {
  return (
    <main className="page page-narrow">
      <Leaderboard />
    </main>
  );
}
