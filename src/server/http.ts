import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { codeSchema, type ErrorCode, type ErrorResponse } from "@/lib/protocol";
import { ServiceError } from "@/server/tables";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  invalid_tile: 400,
  unauthorized: 401,
  not_a_player: 403,
  not_host: 403,
  not_found: 404,
  table_full: 409,
  already_started: 409,
  not_your_turn: 409,
  tile_not_hidden: 409,
  too_many_revealed: 409,
  locked: 409,
  paused: 409,
  pause_unavailable: 409,
  not_pauser: 403,
  not_playing: 409,
  rate_limited: 429,
  conflict: 503,
  internal: 500,
};

export function errorResponse(code: ErrorCode, message: string) {
  return NextResponse.json<ErrorResponse>({ error: { code, message } }, { status: STATUS[code] });
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

/** Wraps a route handler: typed service errors and validation failures become JSON error responses. */
export function route<C extends RouteContext>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ServiceError) return errorResponse(error.code, error.message);
      if (error instanceof z.ZodError) {
        return errorResponse("bad_request", error.issues[0]?.message ?? "Invalid request");
      }
      console.error(error);
      return errorResponse("internal", "Something went wrong");
    }
  };
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown = {};
  const text = await request.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceError("bad_request", "Body must be JSON");
    }
  }
  return schema.parse(body);
}

export async function tableCode(context: RouteContext): Promise<string> {
  const { code } = await context.params;
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) throw new ServiceError("not_found", "No table with that code");
  return parsed.data;
}

/** `since` is the last event seq the client has seen; -1 means "I have nothing yet". */
export function sinceParam(request: Request): number {
  const raw = new URL(request.url).searchParams.get("since");
  const since = raw === null ? -1 : Number(raw);
  return Number.isInteger(since) && since >= -1 ? since : -1;
}
