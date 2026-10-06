import type {
  CreateTableRequest,
  CreateTableResponse,
  ErrorResponse,
  FriendsResponse,
  HistoryEntry,
  LeaderboardResponse,
  LeaderboardScope,
  MeResponse,
  PollResponse,
  PublicTablesResponse,
  SnapshotResponse,
  StatsResponse,
} from "@/lib/protocol";

import { ApiError } from "./api-error";
import { guarded } from "./connection";

export { ApiError };

/** Seconds or an HTTP date, as a delay in milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isNaN(seconds) ? Date.parse(header) - Date.now() : seconds * 1_000;
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

/** GETs are reads: retried and held behind the connection gate. Everything else is a one-shot action. */
const request = <T>(path: string, init?: RequestInit) =>
  guarded<T>(init?.method && init.method !== "GET" ? "action" : "read", () => fetchOnce<T>(path, init));

async function fetchOnce<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError("network", "Can't reach the server. Check your connection.", 0);
  }
  const body = (await response.json().catch(() => null)) as T | ErrorResponse | null;
  if (!response.ok || body === null) {
    const error = (body as ErrorResponse | null)?.error;
    throw new ApiError(
      error?.code ?? "internal",
      error?.message ?? "Something went wrong",
      response.status,
      retryAfterMs(response),
    );
  }
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
const send = <T>(method: "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const table = (code: string, action: string, since: number) =>
  `/api/tables/${encodeURIComponent(code)}/${action}?since=${since}`;

export const api = {
  createTable: (body: CreateTableRequest) => post<CreateTableResponse>("/api/tables", body),
  poll: (code: string, since: number) =>
    request<PollResponse>(`/api/tables/${encodeURIComponent(code)}?since=${since}`),
  join: (code: string, since: number, name?: string) =>
    post<SnapshotResponse>(table(code, "join", since), { name }),
  start: (code: string, since: number) => post<SnapshotResponse>(table(code, "start", since)),
  flip: (code: string, since: number, tileId: number) =>
    post<SnapshotResponse>(table(code, "flip", since), { tileId }),
  dismiss: (code: string, since: number) => post<SnapshotResponse>(table(code, "dismiss", since)),
  pause: (code: string, since: number) => post<SnapshotResponse>(table(code, "pause", since)),
  resume: (code: string, since: number) => post<SnapshotResponse>(table(code, "resume", since)),
  leave: (code: string, since: number) => post<SnapshotResponse>(table(code, "leave", since)),
  publicTables: () => request<PublicTablesResponse>("/api/public-tables"),
  me: () => request<MeResponse>("/api/me"),
  history: () => request<HistoryEntry[]>("/api/me/history"),
  stats: () => request<StatsResponse>("/api/me/stats"),
  leaderboard: (scope: LeaderboardScope) => request<LeaderboardResponse>(`/api/leaderboard?scope=${scope}`),
  friends: () => request<FriendsResponse>("/api/friends"),
  sendFriendRequest: (handle: string) => post<{ ok: true }>("/api/friends/requests", { handle }),
  acceptFriend: (userId: string) => send<{ ok: true }>("PATCH", `/api/friends/${encodeURIComponent(userId)}`),
  removeFriend: (userId: string) =>
    send<{ ok: true }>("DELETE", `/api/friends/${encodeURIComponent(userId)}`),
  dismissInvite: (id: string) =>
    send<{ ok: true }>("DELETE", `/api/friends/invites/${encodeURIComponent(id)}`),
  setHandle: (handle: string) => send<{ handle: string }>("PUT", "/api/me/handle", { handle }),
  heartbeat: () => send<{ handle: string }>("PUT", "/api/me/presence"),
  inviteFriend: (code: string, userId: string) =>
    post<{ ok: true }>(`/api/tables/${encodeURIComponent(code)}/invites`, { userId }),
};
