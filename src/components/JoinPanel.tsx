"use client";

import { useState } from "react";

import { loadGuestName, saveGuestName } from "@/lib/client/guest-name";

import { NameField } from "./NameField";

type Props = { needsName: boolean; pending: boolean; onJoin: (name?: string) => void };

export function JoinPanel({ needsName, pending, onJoin }: Props) {
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
      <button type="submit" className="button" disabled={pending || (needsName && !name.trim())}>
        Join table
      </button>
    </form>
  );
}
