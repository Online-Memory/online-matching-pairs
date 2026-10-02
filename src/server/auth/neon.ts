import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

import { getEnv } from "@/lib/env";

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

export async function getAccountUser(): Promise<AccountUser | null> {
  const auth = getNeonAuth();
  if (!auth) return null;
  try {
    const { data } = await auth.getSession();
    const user = data?.user;
    if (!user) return null;
    return {
      id: user.id,
      name: user.name?.trim() || user.email?.split("@")[0] || "Player",
      email: user.email ?? null,
      image: user.image ?? null,
    };
  } catch (error) {
    // An auth outage shouldn't stop people playing; they fall back to their guest identity.
    console.error("Neon Auth getSession failed", error);
    return null;
  }
}
