"use client";

import { useState } from "react";

import { loadGuestName, saveGuestName } from "@/lib/client/guest-name";
import { PALETTE_SIZE } from "@/lib/protocol";

import { Button } from "./Button";
import { ColourPicker } from "./ColourPicker";
import { NameField } from "./NameField";

type Props = {
  needsName: boolean;
  /** Colours already held at this table. Guests pick from the rest; signed-in players use their saved preferences. */
  takenColours: ReadonlySet<number>;
  pending: boolean;
  joining: boolean;
  onJoin: (name?: string, colour?: number) => void;
};

const firstFree = (taken: ReadonlySet<number>) =>
  Array.from({ length: PALETTE_SIZE }, (_, i) => i).find((i) => !taken.has(i)) ?? 0;

export function JoinPanel({ needsName, takenColours, pending, joining, onJoin }: Props) {
  const [name, setName] = useState(loadGuestName);
  const [picked, setPicked] = useState<number | null>(null);
  // What the picker shows as chosen. Someone may take the pick while the guest is typing: show a free colour instead.
  const colour = picked !== null && !takenColours.has(picked) ? picked : firstFree(takenColours);

  return (
    <form
      className="join-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsName) {
          saveGuestName(name);
          // Only an explicit pick is sent. Otherwise the server gives the lowest free colour at join time, so a friend
          // who joined a second earlier can't turn this join into a "colour taken" error the guest never asked for.
          onJoin(name.trim(), picked ?? undefined);
        } else {
          onJoin();
        }
      }}
    >
      {needsName && <NameField id="join-name" value={name} onChange={setName} />}
      {needsName && (
        <ColourPicker label="Pick your colour" value={colour} taken={takenColours} onPick={setPicked} />
      )}
      <Button type="submit" disabled={pending || (needsName && !name.trim())} pending={joining}>
        Join table
      </Button>
    </form>
  );
}
