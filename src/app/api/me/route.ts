import { NextResponse } from "next/server";

import type { MeResponse } from "@/lib/protocol";
import { authEnabled } from "@/lib/env";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";

export const GET = route(async () =>
  NextResponse.json<MeResponse>({ authEnabled: authEnabled(), user: await getAccountUser() }),
);
