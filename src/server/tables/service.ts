import "server-only";

import { randomUUID } from "node:crypto";

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  type ErrorCode,
  type PollResponse,
  type PublicEvent,
  type SnapshotResponse,
} from "@/lib/protocol";
import { isUniqueViolation, type Db } from "@/server/db";
import { insertTable, loadTable, saveTable, type RosterEntry, type TableRecord } from "@/server/db/tables";
import {
  applyAction,
  computeRanks,
  createTable,
  cryptoRng,
  EngineError,
  nextDueAt,
  tick,
  toView,
  type Action,
  type EngineResult,
  type GameState,
  type Identity,
  type Rng,
  type TableSettings,
} from "@/server/engine";

/** Public events kept on the row so pollers can replay what they missed. */
export const EVENT_RING_SIZE = 30;
const MAX_CAS_ATTEMPTS = 5;
const MAX_CODE_ATTEMPTS = 8;

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

type Options = { clock?: () => number; rng?: Rng };

export class TableService {
  private readonly clock: () => number;
  private readonly rng: Rng;

  constructor(
    private readonly db: Db,
    options: Options = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.rng = options.rng ?? cryptoRng;
  }

  async create(host: Identity, settings: TableSettings): Promise<{ code: string }> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode(this.rng);
      const state = createTable(code, settings, host, this.clock());
      try {
        await insertTable(this.db, { gameId: randomUUID(), state, events: [], nextDueAt: nextDueAt(state) });
        return { code };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ServiceError("internal", "Could not allocate a table code");
  }

  /** Whether `userId` holds a seat (has not left) at a table that is still a lobby. Answers a boolean, never state. */
  async isSeatedInLobby(code: string, userId: string): Promise<boolean> {
    const record = await loadTable(this.db, code);
    return (
      record?.state.status === "lobby" &&
      record.state.players.some((p) => p.userId === userId && p.status !== "left")
    );
  }

  /** Poll: applies any due deadlines, then answers relative to the client's last seen `since`. */
  async poll(code: string, viewerId: string | null, since: number): Promise<PollResponse> {
    const { state, ring } = await this.transact(code, null);
    if (since >= state.seq) {
      const seated = viewerId !== null && state.players.some((p) => p.id === viewerId);
      return { unchanged: true, serverNow: this.clock(), youId: seated ? viewerId : null };
    }
    return this.snapshot(state, ring, viewerId, since);
  }

  async act(code: string, actor: Identity, action: Action, since: number): Promise<SnapshotResponse> {
    const { state, ring } = await this.transact(code, (s, now) =>
      applyAction(s, actor.playerId, action, now, this.rng),
    );
    return this.snapshot(state, ring, actor.playerId, since);
  }

  private snapshot(
    state: GameState,
    ring: PublicEvent[],
    viewerId: string | null,
    since: number,
  ): SnapshotResponse {
    const oldest = ring[0]?.seq ?? state.seq + 1;
    // If the client is further behind than the ring reaches, it gets the snapshot alone.
    const events = since >= oldest - 1 ? ring.filter((e) => e.seq > since) : [];
    return { unchanged: false, serverNow: this.clock(), view: toView(state, viewerId), events };
  }

  /**
   * load -> tick(now) -> mutation -> compare-and-set save. On a version conflict someone else
   * changed the table between our read and write, so start over from their state.
   */
  private async transact(
    code: string,
    mutation: ((state: GameState, now: number) => EngineResult) | null,
  ): Promise<{ state: GameState; ring: PublicEvent[] }> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const record = await loadTable(this.db, code);
      if (!record) throw new ServiceError("not_found", "No table with that code");

      const now = this.clock();
      const ticked = tick(record.state, now);
      let next = ticked;
      if (mutation) {
        try {
          const acted = mutation(ticked.state, now);
          next = { state: acted.state, events: [...ticked.events, ...acted.events] };
        } catch (error) {
          if (error instanceof EngineError) throw new ServiceError(error.code, error.message);
          throw error;
        }
      }

      if (next.events.length === 0) return { state: record.state, ring: record.events };

      const ring = [...record.events, ...next.events].slice(-EVENT_RING_SIZE);
      const saved = await saveTable(this.db, {
        gameId: record.gameId,
        expectedVersion: record.version,
        state: next.state,
        events: ring,
        nextDueAt: nextDueAt(next.state),
        roster: rosterIfChanged(record, next.state),
      });
      if (saved) return { state: next.state, ring };
    }
    throw new ServiceError("conflict", "The table is busy, try again");
  }
}

/** The public roster is written when a game starts and when it ends, not on every move. */
function rosterIfChanged(before: TableRecord, after: GameState): RosterEntry[] | null {
  if (before.state.status === after.status || after.startedAt === null) return null;
  const ranks = after.status === "finished" ? computeRanks(after.players) : null;
  return after.players.map((p) => ({
    player_id: p.id,
    user_id: p.userId,
    display_name: p.name,
    seat: p.seat,
    moves: p.moves,
    pairs: p.pairs,
    best_streak: p.bestStreak,
    rank: ranks?.get(p.id) ?? null,
  }));
}

export function generateCode(rng: Rng): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
  return code;
}
