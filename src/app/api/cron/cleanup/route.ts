import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import { cleanupTables } from "@/server/db/tables";
import { errorResponse, route } from "@/server/http";

/** Daily Vercel Cron. Timers are lazy, so this only tidies up tables nobody will ever poll again. */
export const GET = route(async (request) => {
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return errorResponse("unauthorized", "Unauthorized");
  }
  return NextResponse.json(await cleanupTables(await getDb(), Date.now()));
});
