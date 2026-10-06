import "server-only";

import { getDb } from "@/server/db";
import { getFriendsService } from "@/server/friends";

import { RatingsService } from "./service";

export * from "./service";

let service: Promise<RatingsService> | undefined;

export function getRatingsService(): Promise<RatingsService> {
  service ??= Promise.all([getDb(), getFriendsService()]).then(
    ([db, friends]) => new RatingsService(db, { friends }),
  );
  return service;
}
