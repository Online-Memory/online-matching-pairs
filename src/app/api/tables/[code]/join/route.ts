import { NextResponse } from "next/server";

import { joinRequestSchema, type SnapshotResponse } from "@/lib/protocol";
import { getOrCreateViewer } from "@/server/auth";
import { readJson, route, sinceParam, tableCode } from "@/server/http";
import { getTableService } from "@/server/tables";

type Context = { params: Promise<{ code: string }> };

/** Take a seat in the lobby, or come back after being marked away. */
export const POST = route(async (request, context: Context) => {
  const code = await tableCode(context);
  const body = await readJson(request, joinRequestSchema);
  const viewer = await getOrCreateViewer();
  const identity = {
    playerId: viewer.playerId,
    userId: viewer.userId,
    name: viewer.accountName ?? body.name ?? "",
  };
  const service = await getTableService();
  return NextResponse.json<SnapshotResponse>(
    await service.act(code, identity, { type: "join", identity }, sinceParam(request)),
  );
});
