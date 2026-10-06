import { NextResponse } from "next/server";

import type { StatsResponse } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";
import { getRatingsService } from "@/server/ratings";
import { ServiceError } from "@/server/tables";

export const GET = route(async () => {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to see your stats");
  return NextResponse.json<StatsResponse>(await (await getRatingsService()).statsFor(user.id));
});
