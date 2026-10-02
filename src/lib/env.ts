import "server-only";

import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_UNPOOLED: z.string().optional(),
    NEON_AUTH_BASE_URL: z.url().optional(),
    NEON_AUTH_COOKIE_SECRET: z.string().min(32).optional(),
    GUEST_TOKEN_SECRET: z.string().min(32, "GUEST_TOKEN_SECRET must be at least 32 characters"),
    CRON_SECRET: z.string().min(8),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  })
  .refine((env) => Boolean(env.NEON_AUTH_BASE_URL) === Boolean(env.NEON_AUTH_COOKIE_SECRET), {
    message: "Set both NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET, or neither (guests only)",
  })
  .refine((env) => !(env.VERCEL_ENV && env.DATABASE_URL.startsWith("pglite:")), {
    message: "PGlite is for local development and tests only",
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** CI and dashboards often pass unset secrets as "", which should mean "not configured". */
function withoutEmpty(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

/** Validated server environment. Throws with every problem listed if the configuration is wrong. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(withoutEmpty(process.env));
    if (!parsed.success) throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    cached = parsed.data;
  }
  return cached;
}

export function authEnabled(): boolean {
  return Boolean(getEnv().NEON_AUTH_BASE_URL);
}
