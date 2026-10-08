import "server-only";

import { NextResponse } from "next/server";

import type { SnapshotResponse } from "@/lib/protocol";
import { viewOptions } from "@/server/cheats";
import { getViewer } from "@/server/auth";
import type { Action } from "@/server/engine";
import { route, sinceParam, tableCode } from "@/server/http";
import { awardAfterResponse } from "@/server/progress/after";
import { rateAfterResponse } from "@/server/ratings/after";
import { getTableService, ServiceError } from "@/server/tables";

type Context = { params: Promise<{ code: string }> };

/** POST handler for an action by an existing player (start, flip, leave). */
export function playerAction(toAction: (request: Request) => Promise<Action>) {
  return route(async (request, context: Context) => {
    const code = await tableCode(context);
    const viewer = await getViewer();
    if (!viewer) throw new ServiceError("not_a_player", "You are not seated at this table");
    const action = await toAction(request);
    const service = await getTableService();
    const identity = { playerId: viewer.playerId, userId: viewer.userId, name: viewer.accountName ?? "" };
    const snapshot = await service.act(code, identity, action, sinceParam(request), viewOptions(request));
    if (snapshot.view.status === "finished") {
      rateAfterResponse(code);
      awardAfterResponse(code);
    }
    return NextResponse.json<SnapshotResponse>(snapshot);
  });
}
