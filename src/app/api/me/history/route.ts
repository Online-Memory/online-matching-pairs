import { NextResponse } from "next/server";

import type { HistoryEntry } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { listHistory } from "@/server/db/history";
import { route } from "@/server/http";
import { ServiceError } from "@/server/tables";

export const GET = route(async () => {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to see your games");
  return NextResponse.json<HistoryEntry[]>(await listHistory(await getDb(), user.id));
});
