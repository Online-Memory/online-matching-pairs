import { NextResponse } from "next/server";

import { createTableRequestSchema, getTheme, maxPlayersFor, type CreateTableResponse } from "@/lib/protocol";
import { getOrCreateViewer, toIdentity } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { getTableService, ServiceError } from "@/server/tables";

export const POST = route(async (request) => {
  const body = await readJson(request, createTableRequestSchema);
  if (body.pairs > getTheme(body.theme)!.maxPairs) {
    throw new ServiceError("bad_request", "That theme doesn't have enough tiles for this board");
  }
  const viewer = await getOrCreateViewer();
  const identity = toIdentity(viewer, body.name);
  if (!identity) throw new ServiceError("bad_request", "Enter a name to create a table");

  const service = await getTableService();
  const { code } = await service.create(identity, {
    theme: body.theme,
    pairs: body.pairs,
    maxPlayers: maxPlayersFor(viewer.userId !== null),
    turnSeconds: body.turnSeconds,
    isPublic: body.isPublic ?? false,
    tableName: body.tableName ?? "",
  });
  return NextResponse.json<CreateTableResponse>({ code }, { status: 201 });
});
