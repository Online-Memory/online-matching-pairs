"use client";

import { useState } from "react";

import { loadGuestName, saveGuestName } from "@/lib/client/guest-name";

import { Button } from "./Button";
import { NameField } from "./NameField";

type Props = { needsName: boolean; pending: boolean; joining: boolean; onJoin: (name?: string) => void };

export function JoinPanel({ needsName, pending, joining, onJoin }: Props) {
  const [name, setName] = useState(loadGuestName);

  return (
    <form
      className="join-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsName) saveGuestName(name);
        onJoin(needsName ? name.trim() : undefined);
      }}
    >
      {needsName && <NameField id="join-name" value={name} onChange={setName} />}
      <Button type="submit" disabled={pending || (needsName && !name.trim())} pending={joining}>
        Join table
      </Button>
    </form>
  );
}
