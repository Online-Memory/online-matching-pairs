import { NextResponse } from "next/server";
import { z } from "zod";

import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request, context: Context) => {
  const account = await requireAccount();
  const id = z.uuid().parse((await context.params).id);
  await (await getFriendsService()).dismissInvite(account.id, id);
  return NextResponse.json({ ok: true });
});
