import { NextResponse } from "next/server";

import {
  createTableRequestSchema,
  getTheme,
  GUEST_MAX_PLAYERS,
  MAX_PLAYERS,
  maxPlayersFor,
  type CreateTableResponse,
} from "@/lib/protocol";
import { getOrCreateViewer, toIdentity } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { getTableService, ServiceError } from "@/server/tables";

export const POST = route(async (request) => {
  const body = await readJson(request, createTableRequestSchema);
  if (body.pairs > getTheme(body.theme)!.maxPairs) {
    throw new ServiceError("bad_request", "That theme doesn't have enough tiles for this board");
  }
  const viewer = await getOrCreateViewer();
  if (body.maxPlayers > maxPlayersFor(viewer.userId !== null)) {
    throw new ServiceError(
      "bad_request",
      `Guests can host up to ${GUEST_MAX_PLAYERS} players. Sign in to host up to ${MAX_PLAYERS}.`,
    );
  }
  const identity = toIdentity(viewer, body.name);
  if (!identity) throw new ServiceError("bad_request", "Enter a name to create a table");

  const service = await getTableService();
  const { code } = await service.create(identity, {
    theme: body.theme,
    pairs: body.pairs,
    maxPlayers: body.maxPlayers,
    turnSeconds: body.turnSeconds,
  });
  return NextResponse.json<CreateTableResponse>({ code }, { status: 201 });
});
