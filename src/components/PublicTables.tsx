"use client";

import Link from "next/link";

import { timeAgo } from "@/lib/client/time-ago";
import { usePublicTables } from "@/lib/client/use-public-tables";
import { THEMES } from "@/lib/protocol";

import { LoadingNotice } from "./Spinner";

/** Home page directory of public tables. Open lobbies can be joined; everything else can be watched. */
export function PublicTables() {
  const { tables, error } = usePublicTables();
  const themeName = (id: string) => THEMES.find((t) => t.id === id)?.name ?? id;

  return (
    <section className="friends-card public-tables" aria-labelledby="public-heading">
      <h2 id="public-heading">Public tables</h2>
      {tables === null ? (
        error ? (
          <p className="hint">{error}</p>
        ) : (
          <LoadingNotice>Loading public tables…</LoadingNotice>
        )
      ) : tables.length === 0 ? (
        <p className="hint">No public tables right now.</p>
      ) : (
        <ul className="public-list">
          {tables.map((t) => {
            const canJoin = t.status === "lobby" && t.seats.taken < t.seats.max;
            return (
              <li key={t.code} className="public-row">
                <span className="public-info">
                  <strong className="public-name">{t.tableName || `${t.hostName}'s table`}</strong>
                  <span>
                    {themeName(t.theme)} · {t.pairs * 2} tiles · {t.seats.taken}/{t.seats.max} seats
                    {t.status === "playing" && " · in progress"}
                  </span>
                  <small className="public-meta">
                    Created by {t.hostName} · {timeAgo(t.createdAt)}
                  </small>
                </span>
                <Link className="button" href={`/table/${t.code}`}>
                  {canJoin ? `Join ${t.hostName}` : `Watch ${t.hostName}`}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
