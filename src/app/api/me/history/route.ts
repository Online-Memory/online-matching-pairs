import { NextResponse } from "next/server";
import { z } from "zod";

import type { HistoryPage } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { countHistory, listHistory } from "@/server/db/history";
import { route } from "@/server/http";
import { ServiceError } from "@/server/tables";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const GET = route(async (request) => {
  const params = new URL(request.url).searchParams;
  const { page, pageSize } = querySchema.parse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to see your games");
  const db = await getDb();
  const [entries, total] = await Promise.all([
    listHistory(db, user.id, { limit: pageSize, offset: (page - 1) * pageSize }),
    countHistory(db, user.id),
  ]);
  return NextResponse.json<HistoryPage>({ entries, total, page, pageSize });
});
