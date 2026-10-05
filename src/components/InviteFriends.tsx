"use client";

import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";

/** Lobby picker: invite an online friend to this table. Hides itself for guests and when nobody is online. */
export function InviteFriends({ code }: { code: string }) {
  const { data } = useFriends();
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const online = data?.friends.filter((f) => f.online) ?? [];
  if (online.length === 0) return null;

  async function invite(userId: string) {
    setError(null);
    try {
      await api.inviteFriend(code, userId);
      setInvited((prev) => new Set(prev).add(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
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
            <button
              type="button"
              className="button-quiet"
              disabled={invited.has(f.userId)}
              onClick={() => invite(f.userId)}
            >
              {invited.has(f.userId) ? "Invited" : `Invite ${f.name} (@${f.handle})`}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
