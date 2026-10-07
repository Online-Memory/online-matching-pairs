"use client";

import Link from "next/link";

import { inviteHref } from "@/lib/client/invite-link";
import type { InviteEntry } from "@/lib/protocol";

import { Button } from "./Button";

/** Table invites from friends, shared by the profile's friends panel and the home page notice. */
export function InviteList({
  invites,
  onDismiss,
  isDismissing = () => false,
}: {
  invites: InviteEntry[];
  onDismiss: (id: string) => void;
  /** Whether the dismissal of this invite is still waiting on the server. */
  isDismissing?: (id: string) => boolean;
}) {
  return (
    <ul className="friend-rows" aria-label="Table invites">
      {invites.map((i) => (
        <li key={i.id} className="friend-row">
          <span className="friend-main">
            <strong>
              {i.fromName} <small>@{i.fromHandle}</small>
            </strong>
            <span className="hint">invited you to a table</span>
          </span>
          <span className="friend-actions">
            <Link className="button" href={inviteHref(i.tableCode)}>
              Join {i.tableCode}
            </Link>
            <Button className="button-quiet" onClick={() => onDismiss(i.id)} pending={isDismissing(i.id)}>
              Dismiss
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
