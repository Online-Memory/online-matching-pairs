"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/** Talks to our /api/auth proxy; only used when /api/me reports accounts are enabled. */
export const authClient = createAuthClient();
