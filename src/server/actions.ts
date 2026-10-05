import "server-only";

import { NextResponse } from "next/server";

import type { SnapshotResponse } from "@/lib/protocol";
import { getViewer } from "@/server/auth";
import type { Action } from "@/server/engine";
import { route, sinceParam, tableCode } from "@/server/http";
import { getTableService, ServiceError } from "@/server/tables";

type Context = { params: Promise<{ code: string }> };

/** POST handler for an action by an existing player (start, flip, dismiss, leave). */
export function playerAction(toAction: (request: Request) => Promise<Action>) {
  return route(async (request, context: Context) => {
    const code = await tableCode(context);
    const viewer = await getViewer();
    if (!viewer) throw new ServiceError("not_a_player", "You are not seated at this table");
    const action = await toAction(request);
    const service = await getTableService();
    const identity = { playerId: viewer.playerId, userId: viewer.userId, name: viewer.accountName ?? "" };
    return NextResponse.json<SnapshotResponse>(
      await service.act(code, identity, action, sinceParam(request)),
    );
  });
}
