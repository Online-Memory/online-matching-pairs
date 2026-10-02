import "server-only";

import { cookies } from "next/headers";

import { getEnv } from "@/lib/env";
import type { Identity } from "@/server/engine";

import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, issueGuestToken, verifyGuestToken } from "./guest";
import { getAccountUser } from "./neon";

export { getAccountUser, getNeonAuth } from "./neon";

export type Viewer = { playerId: string; userId: string | null; accountName: string | null };

/**
 * Who is making this request, without creating anything. Signed-in users play as their account;
 * everyone else as the guest id in their signed cookie (if they have one yet).
 */
export async function getViewer(): Promise<Viewer | null> {
  const user = await getAccountUser();
  if (user) return { playerId: `u_${user.id}`, userId: user.id, accountName: user.name };
  const guestId = verifyGuestToken((await cookies()).get(GUEST_COOKIE)?.value, getEnv().GUEST_TOKEN_SECRET);
  return guestId ? { playerId: `g_${guestId}`, userId: null, accountName: null } : null;
}

/** Like getViewer, but issues a guest cookie when the caller has no identity yet. */
export async function getOrCreateViewer(): Promise<Viewer> {
  const existing = await getViewer();
  if (existing) return existing;
  const { id, token } = issueGuestToken(getEnv().GUEST_TOKEN_SECRET);
  (await cookies()).set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Vercel deployments are always HTTPS; local `next start` (E2E) is plain http.
    secure: getEnv().VERCEL_ENV !== undefined,
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  return { playerId: `g_${id}`, userId: null, accountName: null };
}

/** Accounts use their profile name; guests must supply one when they create or join a table. */
export function toIdentity(viewer: Viewer, guestName: string | undefined): Identity | null {
  const name = viewer.accountName ?? guestName;
  return name ? { playerId: viewer.playerId, userId: viewer.userId, name } : null;
}
