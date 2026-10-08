import { NextResponse } from "next/server";

import { setColoursSchema, type ColoursResponse } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const GET = route(async () => {
  const account = await requireAccount();
  const colours = await (await getFriendsService()).colourPrefs(account.id);
  return NextResponse.json<ColoursResponse>({ colours });
});

export const PUT = route(async (request) => {
  const account = await requireAccount();
  const { colours } = await readJson(request, setColoursSchema);
  return NextResponse.json<ColoursResponse>({
    colours: await (await getFriendsService()).setColourPrefs(account, colours),
  });
});
