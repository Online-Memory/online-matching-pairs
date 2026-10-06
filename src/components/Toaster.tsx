"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { inviteHref } from "@/lib/client/invite-link";
import { useFriends } from "@/lib/client/use-friends";

const TOAST_MS = 10_000;
const FADE_MS = 300; // keep in step with --popup-fade in globals.css
const MAX_TOASTS = 3;

type Popup = { key: string; text: string; href: string; action: string };
type Shown = Popup & { leaving: boolean };

function PopupItem({
  popup,
  onLeave,
  onRemove,
}: {
  popup: Shown;
  onLeave: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const { key, leaving } = popup;
  useEffect(() => {
    // Visible for TOAST_MS, then fade out; once faded (or right away after a manual close), drop it.
    const timer = setTimeout(() => (leaving ? onRemove(key) : onLeave(key)), leaving ? FADE_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [key, leaving, onLeave, onRemove]);

  return (
    <li className="popup" data-leaving={leaving}>
      <p className="popup-text">{popup.text}</p>
      <Link className="button" href={popup.href} onClick={() => onLeave(key)}>
        {popup.action}
      </Link>
      <button
        type="button"
        className="button-quiet"
        aria-label="Close notification"
        onClick={() => onLeave(key)}
      >
        ×
      </button>
    </li>
  );
}

/**
 * Transient popups for friend requests and table invites that arrive while the app is open. They sit on top of the
 * banner and the invite card, which stay as the lasting record. Whatever is already pending on the first load is
 * not announced, and nothing pops up during a game.
 */
export function Toaster() {
  const pathname = usePathname();
  const { data } = useFriends();
  const seen = useRef<Set<string> | null>(null);
  const [popups, setPopups] = useState<Shown[]>([]);
  const inGame = pathname.startsWith("/table/");

  useEffect(() => {
    if (!data) return;
    const current: Popup[] = [
      ...data.incoming.map((r) => ({
        key: `request:${r.userId}`,
        text: `${r.name} (@${r.handle}) wants to be your friend.`,
        href: "/profile",
        action: "View",
      })),
      ...data.invites.map((i) => ({
        key: `invite:${i.id}`,
        text: `${i.fromName} (@${i.fromHandle}) invited you to a table.`,
        href: inviteHref(i.tableCode),
        action: `Join ${i.tableCode}`,
      })),
    ];
    const known = seen.current;
    seen.current = new Set(current.map((p) => p.key));
    if (!known || inGame) return; // first load, or mid-game: mark as seen without announcing
    const fresh = current.filter((p) => !known.has(p.key));
    if (fresh.length > 0)
      setPopups((prev) => [...prev, ...fresh.map((p) => ({ ...p, leaving: false }))].slice(-MAX_TOASTS));
  }, [data, inGame]);

  const leave = useCallback(
    (key: string) => setPopups((prev) => prev.map((p) => (p.key === key ? { ...p, leaving: true } : p))),
    [],
  );
  const remove = useCallback((key: string) => setPopups((prev) => prev.filter((p) => p.key !== key)), []);

  if (inGame) return null;
  return (
    <ul className="popups" aria-live="polite" aria-label="Notifications">
      {popups.map((p) => (
        <PopupItem key={p.key} popup={p} onLeave={leave} onRemove={remove} />
      ))}
    </ul>
  );
}
