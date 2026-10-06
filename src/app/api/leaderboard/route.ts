import { NextResponse } from "next/server";
import { z } from "zod";

import type { LeaderboardResponse } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";
import { getRatingsService } from "@/server/ratings";
import { ServiceError } from "@/server/tables";

const scopeSchema = z.enum(["global", "friends"]).default("global");

/** The global board is public; the friends board needs an account. Never returns user ids. */
export const GET = route(async (request) => {
  const scope = scopeSchema.parse(new URL(request.url).searchParams.get("scope") ?? undefined);
  const user = await getAccountUser();
  if (scope === "friends" && !user) {
    throw new ServiceError("unauthorized", "Sign in to see your friends' ranking");
  }
  const ratings = await getRatingsService();
  return NextResponse.json<LeaderboardResponse>(await ratings.leaderboard(scope, user?.id ?? null));
});
