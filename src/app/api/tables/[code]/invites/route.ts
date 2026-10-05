import { NextResponse } from "next/server";

import { inviteRequestSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route, tableCode } from "@/server/http";

type Context = { params: Promise<{ code: string }> };

/** Invite a friend to a lobby you are seated in. Returns nothing about the table. */
export const POST = route(async (request, context: Context) => {
  const code = await tableCode(context);
  const account = await requireAccount();
  const { userId } = await readJson(request, inviteRequestSchema);
  await (await getFriendsService()).invite(account, code, userId);
  return NextResponse.json({ ok: true });
});
