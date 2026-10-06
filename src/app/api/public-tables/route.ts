import { NextResponse } from "next/server";

import type { PublicTablesResponse } from "@/lib/protocol";
import { route } from "@/server/http";
import { getTableService } from "@/server/tables";

/** The public directory. No sign-in needed: anyone may browse, watch and join. */
export const GET = route(async () => {
  const service = await getTableService();
  return NextResponse.json<PublicTablesResponse>(
    { tables: await service.listPublic() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
