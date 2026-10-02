import { getNeonAuth } from "@/server/auth";
import { errorResponse } from "@/server/http";

type Context = { params: Promise<{ path: string[] }> };

/** Proxies the browser's auth calls to Neon Auth (which sets the session cookies on our domain). */
async function handle(method: "GET" | "POST", request: Request, context: Context) {
  const auth = getNeonAuth();
  if (!auth) return errorResponse("not_found", "Accounts are not enabled");
  return auth.handler()[method](request, context);
}

export const GET = (request: Request, context: Context) => handle("GET", request, context);
export const POST = (request: Request, context: Context) => handle("POST", request, context);
