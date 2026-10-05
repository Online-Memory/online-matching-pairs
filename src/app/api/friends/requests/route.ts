import { NextResponse } from "next/server";

import { friendRequestSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const POST = route(async (request) => {
  const account = await requireAccount();
  const { handle } = await readJson(request, friendRequestSchema);
  await (await getFriendsService()).request(account, handle);
  return NextResponse.json({ ok: true });
});
