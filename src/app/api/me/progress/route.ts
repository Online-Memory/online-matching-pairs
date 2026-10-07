import { NextResponse } from "next/server";

import type { ProgressResponse } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";
import { getProgressService } from "@/server/progress";
import { ServiceError } from "@/server/tables";

export const GET = route(async () => {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to see your level");
  return NextResponse.json<ProgressResponse>(await (await getProgressService()).progressFor(user.id));
});
