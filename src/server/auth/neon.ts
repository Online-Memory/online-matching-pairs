import "server-only";

import { createHash } from "node:crypto";

import { createNeonAuth } from "@neondatabase/auth/next/server";
import { cookies } from "next/headers";

import { getEnv } from "@/lib/env";
import { ServiceError } from "@/server/tables/service";

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | null | undefined;

/** Neon Auth server SDK, or null when accounts aren't configured (guest-only mode). */
export function getNeonAuth(): NeonAuth | null {
  if (instance === undefined) {
    const env = getEnv();
    instance =
      env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET
        ? createNeonAuth({
            baseUrl: env.NEON_AUTH_BASE_URL,
            cookies: { secret: env.NEON_AUTH_COOKIE_SECRET },
          })
        : null;
  }
  return instance;
}

export type AccountUser = { id: string; name: string; email: string | null; image: string | null };

/** The cookie the Neon Auth SDK keeps the session token in. Without it there is nothing to look up. */
const SESSION_COOKIE = "__Secure-neon-auth.session_token";
/** A looked-up user is trusted this long before we ask Neon Auth again. */
const FRESH_MS = 60_000;
/** If Neon Auth can't answer, a user looked up within this window still counts as signed in. */
const STALE_MS = 10 * 60_000;
const MAX_ENTRIES = 1_000;

type Cached = { user: AccountUser; at: number };
// Per server instance, keyed by a hash of the session token. Polling turns one player into a request
// per second, and every one of those used to be its own call to Neon Auth.
const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<AccountUser | null>>();

/**
 * The signed-in user, or null when there is no (valid) session. Lookups are cached for a minute and
 * shared between concurrent requests. If we can't tell (Neon Auth is rate limiting, down, or
 * unreachable) a recently seen user is kept; with none, this throws a retryable error rather than
 * returning null: "no user" would silently drop a signed-in player out of their table mid-game.
 */
export async function getAccountUser(): Promise<AccountUser | null> {
  const auth = getNeonAuth();
  if (!auth) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const key = createHash("sha256").update(token).digest("hex");

  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return cached.user;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = fetchUser(auth)
    .then((user) => {
      if (user) remember(key, user);
      else cache.delete(key);
      return user;
    })
    .catch((error: unknown) => {
      if (cached && now - cached.at < STALE_MS) return cached.user;
      throw error;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, lookup);
  return lookup;
}

function remember(key: string, user: AccountUser) {
  cache.delete(key);
  cache.set(key, { user, at: Date.now() });
  // Maps iterate in insertion order, so the first key is the oldest entry.
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

async function fetchUser(auth: NeonAuth): Promise<AccountUser | null> {
  let result;
  try {
    result = await auth.getSession();
  } catch (error) {
    console.error("Neon Auth getSession failed", error);
    throw unavailable();
  }
  const { data, error } = result;
  // The SDK reports upstream failures as `{ data: null, error }` instead of throwing. 4xx other than
  // 429 means the session really is invalid; anything else is a failed lookup.
  if (error && (error.status === undefined || error.status >= 500 || error.status === 429)) {
    console.error("Neon Auth getSession failed", error);
    throw unavailable();
  }
  const user = data?.user;
  if (!user) return null;
  return {
    id: user.id,
    name: user.name?.trim() || user.email?.split("@")[0] || "Player",
    email: user.email ?? null,
    image: user.image ?? null,
  };
}

function unavailable() {
  return new ServiceError("conflict", "Couldn't check your sign-in right now. Retrying…");
}
