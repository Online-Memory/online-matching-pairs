"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/client/api";
import { inviteHref } from "@/lib/client/invite-link";
import { useFriends } from "@/lib/client/use-friends";
import { usePending } from "@/lib/client/use-pending";

import { Button } from "./Button";

/**
 * Site-wide notice of a pending table invite. "Later" quiets the invites seen so far for this visit only:
 * a reload or reopening the app shows any invite that is still pending again. "Dismiss" removes it for good.
 */
export function InviteBanner() {
  const pathname = usePathname();
  const { data, refresh } = useFriends();
  const [later, setLater] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = usePending();

  // An invite to the table you are already looking at has nothing left to offer.
  const waiting =
    data?.invites.filter((i) => !later.includes(i.id) && pathname !== `/table/${i.tableCode}`) ?? [];
  const first = waiting[0];
  if (!data || !first) return null;
  const invite = first;

  async function dismiss() {
    setError(null);
    await pending.run("dismiss", async () => {
      try {
        await api.dismissInvite(invite.id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function postpone() {
    setLater((prev) => [...new Set([...prev, ...data!.invites.map((i) => i.id)])]);
  }

  return (
    <div className="banner" role="status" aria-label="Table invite">
      <p className="banner-text">
        <strong>{invite.fromName}</strong> <small>@{invite.fromHandle}</small> invited you to a table.
        {waiting.length > 1 && (
          <>
            {" "}
            <Link href="/">{waiting.length - 1} more</Link>
          </>
        )}
      </p>
      <div className="banner-actions">
        <Link className="button" href={inviteHref(invite.tableCode)}>
          Join {invite.tableCode}
        </Link>
        <Button className="button-quiet" onClick={dismiss} pending={pending.isPending("dismiss")}>
          Dismiss
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
