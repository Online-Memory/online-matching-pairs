import { NextResponse, type NextRequest } from "next/server";

import { getNeonAuth } from "@/server/auth";

/**
 * Finishes OAuth sign-in. Neon Auth sends the browser back with a one-time verifier, and the SDK's
 * middleware swaps it for a session cookie. Matched only on those requests: run site-wide, the same
 * middleware would send every guest to the sign-in page.
 */
export async function proxy(request: NextRequest) {
  const auth = getNeonAuth();
  return auth ? auth.middleware()(request) : NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      has: [{ type: "query", key: "neon_auth_session_verifier" }],
    },
  ],
};
