"use client";

import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";
import { usePending } from "@/lib/client/use-pending";

import { Button } from "./Button";

/** Lobby picker: invite an online friend to this table. Hides itself for guests and when nobody is free to invite. */
export function InviteFriends({ code }: { code: string }) {
  const { data } = useFriends();
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const pending = usePending();
  const online = data?.friends.filter((f) => f.online && !f.inGame) ?? [];
  if (online.length === 0) return null;

  async function invite(userId: string) {
    setError(null);
    await pending.run(userId, async () => {
      try {
        await api.inviteFriend(code, userId);
        setInvited((prev) => new Set(prev).add(userId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <section className="invite-friends" aria-label="Invite friends">
      <h3>Invite a friend</h3>
      <ul>
        {online.map((f) => (
          <li key={f.userId} data-online>
            <span className="presence-dot" aria-hidden />
            <span>
              {f.name} <small>@{f.handle}</small>
            </span>
            <Button
              className="button-quiet"
              disabled={invited.has(f.userId)}
              pending={pending.isPending(f.userId)}
              onClick={() => invite(f.userId)}
            >
              {invited.has(f.userId) ? "Invited" : `Invite ${f.name} (@${f.handle})`}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
