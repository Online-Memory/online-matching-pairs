"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";

/**
 * Site-wide notice of a pending friend request. "Later" quiets the requests seen so far for this visit only:
 * a reload or reopening the app shows any request that is still pending again.
 */
export function FriendRequestBanner() {
  const pathname = usePathname();
  const { data, refresh } = useFriends();
  const [later, setLater] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Don't interrupt a game; requests wait on the profile page and in the banner afterwards.
  if (pathname.startsWith("/table/")) return null;
  const waiting = data?.incoming.filter((r) => !later.includes(r.userId)) ?? [];
  const request = waiting[0];
  if (!data || !request) return null;

  async function answer(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  function postpone() {
    setLater((prev) => [...new Set([...prev, ...data!.incoming.map((r) => r.userId)])]);
  }

  const label = `${request.name} (@${request.handle})`;
  return (
    <div className="banner" role="status">
      <p className="banner-text">
        <strong>{request.name}</strong> <small>@{request.handle}</small> wants to be your friend.
        {waiting.length > 1 && (
          <>
            {" "}
            <Link href="/profile">{waiting.length - 1} more</Link>
          </>
        )}
      </p>
      <div className="banner-actions">
        <button
          type="button"
          className="button"
          aria-label={`Accept ${label}`}
          onClick={() => answer(() => api.acceptFriend(request.userId))}
        >
          Accept
        </button>
        <button
          type="button"
          className="button-quiet"
          aria-label={`Decline ${label}`}
          onClick={() => answer(() => api.removeFriend(request.userId))}
        >
          Decline
        </button>
        <button type="button" className="button-quiet" onClick={postpone}>
          Later
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error banner-error">
          {error}
        </p>
      )}
    </div>
  );
}
