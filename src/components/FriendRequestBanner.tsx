"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";
import { usePending } from "@/lib/client/use-pending";

import { Button } from "./Button";

/**
 * Site-wide notice of a pending friend request. "Later" quiets the requests seen so far for this visit only:
 * a reload or reopening the app shows any request that is still pending again.
 */
export function FriendRequestBanner() {
  const pathname = usePathname();
  const { data, refresh } = useFriends();
  const [later, setLater] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = usePending();

  // Don't interrupt a game; requests wait on the profile page and in the banner afterwards.
  if (pathname.startsWith("/table/")) return null;
  const waiting = data?.incoming.filter((r) => !later.includes(r.userId)) ?? [];
  const request = waiting[0];
  if (!data || !request) return null;

  async function answer(kind: "accept" | "decline", action: () => Promise<unknown>) {
    setError(null);
    await pending.run(kind, async () => {
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function postpone() {
    setLater((prev) => [...new Set([...prev, ...data!.incoming.map((r) => r.userId)])]);
  }

  // Once one answer is on its way, the other would contradict it.
  const answering = pending.isPending("accept") || pending.isPending("decline");
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
        <Button
          aria-label={`Accept ${label}`}
          onClick={() => answer("accept", () => api.acceptFriend(request.userId))}
          disabled={answering}
          pending={pending.isPending("accept")}
        >
          Accept
        </Button>
        <Button
          className="button-quiet"
          aria-label={`Decline ${label}`}
          onClick={() => answer("decline", () => api.removeFriend(request.userId))}
          disabled={answering}
          pending={pending.isPending("decline")}
        >
          Decline
        </Button>
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
