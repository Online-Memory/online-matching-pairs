import { NextResponse } from "next/server";

import type { PollResponse } from "@/lib/protocol";
import { viewOptions } from "@/server/cheats";
import { getViewer } from "@/server/auth";
import { route, sinceParam, tableCode } from "@/server/http";
import { getTableService } from "@/server/tables";

type Context = { params: Promise<{ code: string }> };

/** Poll. Anyone with the code may watch; the view is redacted for whoever is asking. */
export const GET = route(async (request, context: Context) => {
  const code = await tableCode(context);
  const viewer = await getViewer();
  const service = await getTableService();
  return NextResponse.json<PollResponse>(
    await service.poll(code, viewer?.playerId ?? null, sinceParam(request), viewOptions(request)),
  );
});
