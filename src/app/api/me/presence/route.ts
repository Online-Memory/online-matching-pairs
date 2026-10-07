import { NextResponse } from "next/server";

import { presenceRequestSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const PUT = route(async (request) => {
  const account = await requireAccount();
  const { tableCode } = await readJson(request, presenceRequestSchema);
  const handle = await (await getFriendsService()).touch(account, tableCode);
  return NextResponse.json({ handle });
});
