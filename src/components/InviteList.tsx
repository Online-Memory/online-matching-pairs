"use client";

import Link from "next/link";

import type { InviteEntry } from "@/lib/protocol";

/** Table invites from friends, shared by the profile's friends panel and the home page notice. */
export function InviteList({
  invites,
  onDismiss,
}: {
  invites: InviteEntry[];
  onDismiss: (id: string) => void;
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
            <Link className="button" href={`/table/${i.tableCode}`}>
              Join {i.tableCode}
            </Link>
            <button type="button" className="button-quiet" onClick={() => onDismiss(i.id)}>
              Dismiss
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
