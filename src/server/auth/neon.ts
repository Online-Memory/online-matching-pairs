import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

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

/**
 * The signed-in user, or null when there is no (valid) session. If we can't tell (Neon Auth is
 * rate limiting, down, or unreachable) this throws a retryable error rather than returning null:
 * "no user" would silently drop a signed-in player out of their table mid-game.
 */
export async function getAccountUser(): Promise<AccountUser | null> {
  const auth = getNeonAuth();
  if (!auth) return null;
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
