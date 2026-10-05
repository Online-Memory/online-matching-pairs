import { NextResponse } from "next/server";

import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

export const PUT = route(async () => {
  const account = await requireAccount();
  const handle = await (await getFriendsService()).touch(account);
  return NextResponse.json({ handle });
});
