"use client";

import { useState } from "react";

import type { TableAction } from "@/lib/client/use-table";
import { getTheme, type TableView } from "@/lib/protocol";

import { Button } from "./Button";
import { InviteFriends } from "./InviteFriends";
import { JoinPanel } from "./JoinPanel";

type Props = {
  view: TableView;
  needsName: boolean;
  pending: boolean;
  pendingAction: TableAction | null;
  onJoin: (name?: string) => void;
  onStart: () => void;
  onLeave: () => void;
};

export function Lobby({ view, needsName, pending, pendingAction, onJoin, onStart, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const isPlayer = view.youId !== null;
  const isHost = view.youId === view.hostId;
  const full = view.players.length >= view.maxPlayers;

  async function copyLink() {
    await navigator.clipboard?.writeText(`${location.origin}/table/${view.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="lobby">
      <div className="lobby-code">
        <p>Table code</p>
        <strong data-testid="table-code">{view.code}</strong>
        <button type="button" className="button-quiet" onClick={copyLink}>
          {copied ? "Link copied" : "Copy invite link"}
        </button>
      </div>

      <p className="lobby-settings">
        {getTheme(view.theme)?.name} theme, {view.pairs * 2} tiles, {view.turnSeconds}s per turn, up to{" "}
        {view.maxPlayers} players
      </p>

      <ul className="lobby-players" aria-label="Seated players">
        {view.players.map((p) => (
          <li key={p.id} data-seat={p.seat}>
            <span className="seat-token" aria-hidden />
            {p.name}
            {p.isHost && <span className="seat-note"> host</span>}
            {p.id === view.youId && <span className="seat-note"> (you)</span>}
          </li>
        ))}
        {!full && (
          <li className="lobby-empty">
            {view.maxPlayers - view.players.length} open{" "}
            {view.maxPlayers - view.players.length === 1 ? "seat" : "seats"}
          </li>
        )}
      </ul>

      {isPlayer && !full && <InviteFriends code={view.code} />}

      {!isPlayer &&
        (full ? (
          <p className="notice">This table is full.</p>
        ) : (
          <JoinPanel
            needsName={needsName}
            pending={pending}
            joining={pendingAction === "join"}
            onJoin={onJoin}
          />
        ))}

      {isPlayer && (
        <div className="actions">
          {isHost ? (
            <Button onClick={onStart} disabled={pending} pending={pendingAction === "start"}>
              {view.players.length === 1 ? "Start solo game" : "Start game"}
            </Button>
          ) : (
            <p className="notice">Waiting for the host to start the game.</p>
          )}
          <Button
            className="button-quiet"
            onClick={onLeave}
            disabled={pending}
            pending={pendingAction === "leave"}
          >
            Leave table
          </Button>
        </div>
      )}
    </section>
  );
}
