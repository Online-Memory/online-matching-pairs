import { NextResponse } from "next/server";

import type { FriendsResponse } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

export const GET = route(async () => {
  const account = await requireAccount();
  return NextResponse.json<FriendsResponse>(await (await getFriendsService()).overview(account));
});
