import "server-only";

import { CHEAT_CODES, CHEAT_HEADER, type CheatCode } from "@/lib/protocol";

import type { ViewOptions } from "@/server/engine";

/** On in development and tests; a production build needs `ENABLE_CHEATS=1`. */
function cheatsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_CHEATS === "1";
}

/** The cheat codes a request opted into. Unknown codes are ignored, and all are ignored when cheats are off. */
export function parseCheats(request: Request): Set<CheatCode> {
  if (!cheatsEnabled()) return new Set();
  const asked = (request.headers.get(CHEAT_HEADER) ?? "").split(",").map((c) => c.trim());
  return new Set(CHEAT_CODES.filter((code) => asked.includes(code)));
}

/** What the opted-in codes change about the view built for this request. */
export function viewOptions(request: Request): ViewOptions {
  return { revealAll: parseCheats(request).has("cheatmode") };
}
