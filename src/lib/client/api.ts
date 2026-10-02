import type {
  CreateTableRequest,
  CreateTableResponse,
  ErrorCode,
  ErrorResponse,
  HistoryEntry,
  MeResponse,
  PollResponse,
  SnapshotResponse,
} from "@/lib/protocol";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new ApiError(error?.code ?? "internal", error?.message ?? "Something went wrong", response.status);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
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
  leave: (code: string, since: number) => post<SnapshotResponse>(table(code, "leave", since)),
  me: () => request<MeResponse>("/api/me"),
  history: () => request<HistoryEntry[]>("/api/me/history"),
};
