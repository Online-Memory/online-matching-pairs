"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth-client";
import { invalidateMe, useMe } from "@/lib/client/use-me";
import { getTheme, type HistoryEntry } from "@/lib/protocol";

import { ordinal } from "./Scoreboard";

export function Profile() {
  const me = useMe();
  const router = useRouter();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    if (me?.user) api.history().then(setHistory, () => setHistory([]));
  }, [me?.user]);

  if (!me) return <p className="notice">Loading…</p>;
  if (!me.user) {
    return (
      <>
        <h1>Your games</h1>
        <p>Sign in to keep a record of the games you finish.</p>
        <Link className="button" href="/auth/sign-in">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1>{me.user.name}</h1>
      {me.user.email && <p className="hint">{me.user.email}</p>}
      <h2>Finished games</h2>
      {history === null ? (
        <p className="notice">Loading…</p>
      ) : history.length === 0 ? (
        <p>
          No finished games yet. <Link href="/">Set up a table</Link> and play one to the end.
        </p>
      ) : (
        <ul className="history" data-testid="history">
          {history.map((game) => (
            <li key={game.code + game.finishedAt}>
              <strong>{game.you.rank ? ordinal(game.you.rank) : "Played"}</strong>
              <span>
                {getTheme(game.theme)?.name ?? game.theme}, {game.pairs * 2} tiles
              </span>
              <span>
                {game.you.pairs} pairs in {game.you.moves} moves
              </span>
              <span className="hint">
                {game.players.map((p) => (p.isYou ? "you" : p.name)).join(", ")} on{" "}
                {new Date(game.finishedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button-quiet"
        onClick={async () => {
          await authClient.signOut();
          invalidateMe();
          router.push("/");
          router.refresh();
        }}
      >
        Sign out
      </button>
    </>
  );
}
