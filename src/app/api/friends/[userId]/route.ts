import { NextResponse } from "next/server";

import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

type Context = { params: Promise<{ userId: string }> };

/** Accept a request from `userId`. */
export const PATCH = route(async (_request, context: Context) => {
  const account = await requireAccount();
  const { userId } = await context.params;
  await (await getFriendsService()).accept(account, userId);
  return NextResponse.json({ ok: true });
});

/** Decline, cancel or unfriend. */
export const DELETE = route(async (_request, context: Context) => {
  const account = await requireAccount();
  const { userId } = await context.params;
  await (await getFriendsService()).remove(account, userId);
  return NextResponse.json({ ok: true });
});
