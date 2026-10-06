import type { ErrorCode } from "@/lib/protocol";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    message: string,
    readonly status: number,
    /** From a `Retry-After` header: how long the server asked us to wait. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
