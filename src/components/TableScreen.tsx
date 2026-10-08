"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { finishMessage } from "@/lib/client/finish-message";
import { BURST_COUNT, streakTier, type StreakTier } from "@/lib/client/streak-tier";
import { useIdleLevel } from "@/lib/client/use-idle-level";
import { useMe } from "@/lib/client/use-me";
import { useTable } from "@/lib/client/use-table";
import type { PublicEvent, TableView } from "@/lib/protocol";

import { Board } from "./Board";
import { BoardCue } from "./BoardCue";
import { Button } from "./Button";
import { CELEBRATION_MS, Confetti, ConfettiBurst } from "./Confetti";
import { FinishBanner } from "./FinishBanner";
import { FlipBackBar } from "./FlipBackBar";
import { Lobby } from "./Lobby";
import { KickVoteBar } from "./KickVoteBar";
import { PauseBar } from "./PauseBar";
import { Results } from "./Results";
import { Scoreboard } from "./Scoreboard";
import { ScorePopup } from "./ScorePopup";
import { Spotlight } from "./Spotlight";
import { LoadingNotice } from "./Spinner";

/** `autoJoin`: arrived by accepting a table invite, so seat a signed-in visitor without another click. */
export function TableScreen({ code, autoJoin = false }: { code: string; autoJoin?: boolean }) {
  const table = useTable(code);
  const me = useMe();
  const { view, actionError, clearActionError } = table;
  const idleLevel = useIdleLevel(view, table.serverOffset);

  useEffect(() => {
    if (!actionError) return;
    const id = setTimeout(clearActionError, 3500);
    return () => clearTimeout(id);
  }, [actionError, clearActionError]);

  const autoJoined = useRef(false);
  const join = table.join;
  const canAutoJoin =
    autoJoin && !!me?.user && view?.status === "lobby" && !view.players.some((p) => p.id === view.youId);
  useEffect(() => {
    if (!canAutoJoin || autoJoined.current) return;
    autoJoined.current = true; // one attempt: if it fails, the Join button is still there
    void join();
  }, [canAutoJoin, join]);

  // Confetti when a game finishes while we are watching it, not for a table that was already over.
  const [confetti, setConfetti] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const status = view?.status ?? null;
  const message = view ? finishMessage(view) : null;
  useEffect(() => {
    const previous = lastStatus.current;
    lastStatus.current = status;
    if (previous !== "playing" || status !== "finished") return;
    setConfetti(true);
    const id = setTimeout(() => setConfetti(false), CELEBRATION_MS);
    return () => clearTimeout(id);
  }, [status]);

  // A freshly matched pair gets a short celebration. Events already there on first load are history.
  const [celebrating, setCelebrating] = useState<number[]>([]);
  const seenSeq = useRef<number | null>(null);
  useEffect(() => {
    const last = table.events.at(-1);
    if (!last) return;
    const previous = seenSeq.current;
    seenSeq.current = last.seq;
    if (previous === null) return;
    const matched = table.events.findLast((e) => e.seq > previous && e.type === "pair_matched");
    if (matched?.type !== "pair_matched") return;
    setCelebrating(matched.tileIds);
    const id = setTimeout(() => setCelebrating([]), 1400);
    return () => clearTimeout(id);
  }, [table.events]);

  // Score pop-up + confetti burst at the matched pair. The streak comes from the view, which arrives
  // in the same response as the event. Its own timer: the events effect above is re-run (and its
  // cleanup fires) by any later event, so it must not own this timeout.
  type MatchFx = { key: number; x: number; y: number; label: string; tier: StreakTier };
  const [matchFx, setMatchFx] = useState<MatchFx | null>(null);
  const playersRef = useRef(view?.players);
  useEffect(() => {
    playersRef.current = view?.players;
  });
  const seenFxSeq = useRef<number | null>(null);
  useEffect(() => {
    const last = table.events.at(-1);
    if (!last) return;
    const previous = seenFxSeq.current;
    seenFxSeq.current = last.seq;
    if (previous === null) return;
    const matched = table.events.findLast((e) => e.seq > previous && e.type === "pair_matched");
    if (matched?.type !== "pair_matched") return;
    const streak = playersRef.current?.find((p) => p.id === matched.playerId)?.streak ?? 0;
    const tile = document.querySelector<HTMLElement>(`[data-tile-id="${matched.tileIds[1]}"]`);
    const box = tile?.getBoundingClientRect();
    setMatchFx({
      key: matched.seq,
      x: box ? box.left + box.width / 2 : window.innerWidth / 2,
      y: box ? box.top + box.height / 2 : window.innerHeight / 2,
      label: streak >= 2 ? `+1 · x${streak} streak` : "+1",
      tier: streakTier(streak),
    });
  }, [table.events]);
  useEffect(() => {
    if (!matchFx) return;
    // Longer than the CSS animation (flip delay + 2.2s) so the pop-up is never cut off mid-fade.
    const id = setTimeout(() => setMatchFx(null), 3000);
    return () => clearTimeout(id);
  }, [matchFx]);

  // After a miss the player whose turn it is can click anywhere to turn the pair face down early.
  const canDismiss =
    view?.status === "playing" &&
    !view.pause &&
    view.lockUntil !== null &&
    view.turn?.playerId === view.youId &&
    !table.flippedBack;
  const dismissRef = useRef(table.dismiss);
  useEffect(() => {
    dismissRef.current = table.dismiss;
  });
  // The click that follows a dismissing release must not also flip the tile under the cursor, even when
  // the turn comes straight back to this player (solo game) and the tile is flippable again by then.
  const swallowClick = useRef(false);
  useEffect(() => {
    if (!canDismiss) return;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      swallowClick.current = true;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => (swallowClick.current = false), 1000);
      void dismissRef.current();
    };
    window.addEventListener("pointerup", onPointerUp);
    // The swallow timer is left running on purpose: the click arrives after the dismiss ended the lock.
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, [canDismiss]);
  useEffect(() => {
    // Capture phase on window runs before React's handlers, so the tile never sees this click.
    const onClick = (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  if (table.loadError?.code === "not_found") {
    return (
      <main className="page page-narrow">
        <h1>No table called {code}</h1>
        <p>Check the code with whoever invited you, or set up a new table.</p>
        <Link className="button" href="/">
          Set up a table
        </Link>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="page page-narrow" aria-busy>
        {table.loadError ? (
          <p className="notice">{table.loadError.message}</p>
        ) : (
          <LoadingNotice>Opening table {code}…</LoadingNotice>
        )}
      </main>
    );
  }

  const you = view.players.find((p) => p.id === view.youId);
  const myTurn =
    view.status === "playing" && !view.pause && view.turn?.playerId === view.youId && view.lockUntil === null;
  const revealedCount = view.tiles.filter((t) => t.state === "revealed").length;
  const canFlip = myTurn && revealedCount < 2 && !table.pending;

  // Outside the lobby the bar sits above the board, in the board's column.
  const tableBar = (
    <header className="table-bar">
      <h1 className="table-title">
        Table <span data-testid="table-code-bar">{view.code}</span>
      </h1>
      {view.canPause && (
        <Button
          className="button-quiet"
          onClick={() => void table.pause()}
          disabled={table.pending}
          pending={table.pendingAction === "pause"}
        >
          Pause
        </Button>
      )}
      {view.status === "playing" && you && you.status !== "left" && (
        <Button
          className="button-quiet"
          onClick={() => void table.leave()}
          disabled={table.pending}
          pending={table.pendingAction === "leave"}
        >
          Leave
        </Button>
      )}
    </header>
  );

  const statusLine = (
    <p className="status-line" role="status" data-testid="status-line">
      {statusText(view, myTurn)}
    </p>
  );

  return (
    <main className="page table-page" data-status={view.status} data-my-turn={myTurn}>
      {view.status === "lobby" && tableBar}

      {view.status === "lobby" ? (
        <Lobby
          view={view}
          needsName={me !== null && !me.user}
          pending={table.pending}
          pendingAction={table.pendingAction}
          onJoin={(name, colour) => void table.join(name, colour)}
          onChooseColour={(colour) => void table.chooseColour(colour)}
          onStart={() => void table.start()}
          onLeave={() => void table.leave()}
        />
      ) : (
        <div className="table-layout">
          <div className="table-head">{view.status === "finished" && statusLine}</div>
          <div className="table-side">
            {tableBar}
            <Scoreboard view={view} serverOffset={table.serverOffset} idleLevel={idleLevel} />
            {view.status !== "finished" && statusLine}
            {view.tiles.some((t) => t.state === "hidden" && t.peek !== undefined) && (
              <p className="status-line" data-testid="cheat-badge">
                Cheat mode: face-down tiles are shown faintly
              </p>
            )}
            {view.status === "playing" && !view.pause && (
              <KickVoteBar view={view} pending={table.pending} onVote={() => void table.voteKick()} />
            )}
            {you?.status === "kicked" && view.status === "playing" && (
              <div className="notice-block">
                <p>The other players voted you out of this game. You can keep watching until it ends.</p>
              </div>
            )}
            {view.status === "playing" && view.lockUntil !== null && !view.pause && (
              <FlipBackBar
                key={view.lockUntil}
                lockUntil={view.lockUntil}
                serverOffset={table.serverOffset}
                canDismiss={canDismiss}
              />
            )}
            {you?.status === "away" && view.status === "playing" && (
              <div className="away-banner">
                <p>You missed three turns in a row, so your turns are being skipped.</p>
                <Button
                  onClick={() => void table.join()}
                  disabled={table.pending}
                  pending={table.pendingAction === "join"}
                >
                  I&apos;m back
                </Button>
              </div>
            )}
            {view.status === "finished" && <Results view={view} />}
            {view.status === "abandoned" && (
              <div className="notice-block">
                <p>This game ended because everyone left or stopped playing.</p>
                <Link className="button" href="/">
                  Set up a new table
                </Link>
              </div>
            )}
          </div>
          <Board
            tiles={view.tiles}
            theme={view.theme}
            players={view.players}
            canFlip={canFlip}
            paused={!!view.pause}
            pauseBar={
              view.pause && (
                <PauseBar
                  view={view}
                  serverOffset={table.serverOffset}
                  pending={table.pending}
                  onResume={() => void table.resume()}
                />
              )
            }
            celebrating={celebrating}
            onFlip={(id) => void table.flip(id)}
            cue={myTurn && !view.turn?.timedOut ? <BoardCue level={idleLevel} /> : undefined}
          />
          {view.status === "finished" && (
            <div className="table-actions">
              <Link className="button" href="/">
                Set up another table
              </Link>
            </div>
          )}
          <div className="table-foot">
            {view.status === "playing" && <Spotlight view={view} />}
            <p className="activity" aria-live="polite">
              {describe(table.events.at(-1), view)}
            </p>
          </div>
        </div>
      )}

      {matchFx && (
        <Fragment key={matchFx.key}>
          <ScorePopup x={matchFx.x} y={matchFx.y} label={matchFx.label} tier={matchFx.tier} />
          <ConfettiBurst x={matchFx.x} y={matchFx.y} count={BURST_COUNT[matchFx.tier]} delayMs={320} />
        </Fragment>
      )}

      {confetti && view && (
        <>
          {message && <FinishBanner message={message} durationMs={CELEBRATION_MS} />}
          <Confetti />
        </>
      )}

      {actionError && (
        <p className="toast" role="alert">
          {actionError.message}
        </p>
      )}
    </main>
  );
}

function nameOf(view: TableView, playerId: string) {
  return playerId === view.youId ? "You" : (view.players.find((p) => p.id === playerId)?.name ?? "Someone");
}

function statusText(view: TableView, myTurn: boolean) {
  if (view.status === "finished") return "Game over";
  if (view.status === "abandoned") return "Game abandoned";
  if (!view.youId && view.status === "playing") return "You're watching this game";
  if (view.pause) return "Game paused";
  if (view.lockUntil !== null) {
    return view.turn?.playerId === view.youId ? "No match. Flipping back…" : "No match. Flipping back…";
  }
  if (view.turn?.timedOut) {
    return view.turn.playerId === view.youId
      ? "You ran out of time. Flip a tile to carry on."
      : `${nameOf(view, view.turn.playerId)} ran out of time`;
  }
  if (!view.turn) return "Waiting for players to come back";
  if (myTurn) return "Your turn. Flip two tiles.";
  return `${nameOf(view, view.turn.playerId)}'s turn`;
}

function describe(event: PublicEvent | undefined, view: TableView): string {
  if (!event) return "";
  switch (event.type) {
    case "pair_matched":
      return `${nameOf(view, event.playerId)} found a pair`;
    case "pair_missed":
      return `${nameOf(view, event.playerId)} missed`;
    case "turn_timed_out":
      return `${nameOf(view, event.playerId)} ran out of time`;
    case "player_away":
      return `${nameOf(view, event.playerId)} is away`;
    case "player_returned":
      return `${nameOf(view, event.playerId)} is back`;
    case "player_left":
      return `${nameOf(view, event.playerId)} left the game`;
    case "paused":
      return `${nameOf(view, event.playerId)} paused the game`;
    case "resumed":
      return "Game resumed";
    case "kick_vote":
      return `${nameOf(view, event.playerId)} voted to kick ${view.turn?.timedOut ? nameOf(view, view.turn.playerId) : "a player"}`;
    case "player_kicked":
      return `${nameOf(view, event.playerId)} was voted out of the game`;
    case "host_changed":
      return `${nameOf(view, event.playerId)} is now the host`;
    default:
      return "";
  }
}
