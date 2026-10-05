"use client";

import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";
import { useMe } from "@/lib/client/use-me";

import { InviteList } from "./InviteList";

function lastSeen(iso: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `Last seen ${hours} h ago` : `Last seen ${Math.round(hours / 24)} d ago`;
}

const HANDLE_HINT = "3–20 letters, numbers or underscores";

export function FriendsPanel() {
  const me = useMe();
  const { data, error, refresh } = useFriends();
  const [handle, setHandle] = useState("");
  const [editing, setEditing] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (!me?.user || !data) return null;

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    }
  }

  const friends = [...data.friends].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
  );
  const shown = actionError ?? error;

  return (
    <section className="friends" aria-labelledby="friends-title">
      <h2 id="friends-title">Friends</h2>

      <div className="friends-card">
        <div className="handle-row">
          <div>
            <p className="hint">Your handle</p>
            <strong className="handle">@{data.handle}</strong>
          </div>
          {!editing && (
            <button type="button" className="button-quiet" onClick={() => setEditing(true)}>
              Change handle
            </button>
          )}
        </div>
        {editing && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newHandle.trim()) return;
              void run(() => api.setHandle(newHandle)).then((ok) => {
                if (!ok) return;
                setNewHandle("");
                setEditing(false);
              });
            }}
          >
            <div className="field">
              <label htmlFor="my-handle">New handle</label>
              <input
                id="my-handle"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                maxLength={21}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="my-handle-hint"
              />
              <p id="my-handle-hint" className="hint field-hint">
                {HANDLE_HINT}
              </p>
            </div>
            <div className="form-actions">
              <button type="submit" className="button" disabled={!newHandle.trim()}>
                Save
              </button>
              <button type="button" className="button-quiet" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {data.invites.length > 0 && (
        <div className="friends-card">
          <h3>Table invites</h3>
          <InviteList invites={data.invites} onDismiss={(id) => void run(() => api.dismissInvite(id))} />
        </div>
      )}

      {data.incoming.length > 0 && (
        <div className="friends-card">
          <h3>Friend requests</h3>
          <ul className="friend-rows" aria-label="Friend requests">
            {data.incoming.map((r) => (
              <li key={r.userId} className="friend-row">
                <span className="avatar" aria-hidden>
                  {r.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="friend-main">
                  <strong>{r.name}</strong>
                  <span className="hint">@{r.handle}</span>
                </span>
                <span className="friend-actions">
                  <button
                    type="button"
                    className="button"
                    aria-label={`Accept ${r.name} (@${r.handle})`}
                    onClick={() => run(() => api.acceptFriend(r.userId))}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="button-quiet"
                    aria-label={`Decline ${r.name} (@${r.handle})`}
                    onClick={() => run(() => api.removeFriend(r.userId))}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="friends-card">
        <h3>Your friends</h3>
        {friends.length === 0 ? (
          <p className="hint">No friends yet. Share your handle, or add someone below.</p>
        ) : (
          <ul className="friend-rows" aria-label="Friends">
            {friends.map((f) => (
              <li key={f.userId} className="friend-row" aria-label={f.name} data-online={f.online}>
                <span className="avatar" aria-hidden>
                  {f.name.slice(0, 1).toUpperCase()}
                  <span className="presence-dot" />
                </span>
                <span className="friend-main">
                  <strong>
                    {f.name} <small>@{f.handle}</small>
                  </strong>
                  <span className="hint">{f.online ? "Online" : lastSeen(f.lastSeenAt)}</span>
                </span>
                <button
                  type="button"
                  className="button-quiet"
                  aria-label={`Remove ${f.name} (@${f.handle})`}
                  onClick={() => run(() => api.removeFriend(f.userId))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {data.outgoing.length > 0 && (
          <p className="hint">Waiting on {data.outgoing.map((r) => `@${r.handle}`).join(", ")}</p>
        )}
      </div>

      <form
        className="friends-card inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!handle.trim()) return;
          void run(() => api.sendFriendRequest(handle)).then((ok) => ok && setHandle(""));
        }}
      >
        <div className="field">
          <label htmlFor="friend-handle">Add a friend&apos;s handle</label>
          <input
            id="friend-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@handle"
            aria-describedby="friend-handle-hint"
          />
          <p id="friend-handle-hint" className="hint field-hint">
            Ask them for their handle. They&apos;ll need to accept.
          </p>
        </div>
        <button type="submit" className="button" disabled={!handle.trim()}>
          Send request
        </button>
      </form>

      {shown && (
        <p role="alert" className="form-error">
          {shown}
        </p>
      )}
    </section>
  );
}
