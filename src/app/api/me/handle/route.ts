import { NextResponse } from "next/server";

import { setHandleSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const PUT = route(async (request) => {
  const account = await requireAccount();
  const { handle } = await readJson(request, setHandleSchema);
  return NextResponse.json({ handle: await (await getFriendsService()).setHandle(account, handle) });
});
