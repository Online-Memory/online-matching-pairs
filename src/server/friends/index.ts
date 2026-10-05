import "server-only";

import { getAccountUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { getTableService, ServiceError } from "@/server/tables";

import { FriendsService, type Account } from "./service";

export * from "./service";

let service: Promise<FriendsService> | undefined;

export function getFriendsService(): Promise<FriendsService> {
  service ??= Promise.all([getDb(), getTableService()]).then(
    ([db, tables]) => new FriendsService(db, { seating: tables }),
  );
  return service;
}

/** Friends are for signed-in accounts. Guests, and deployments without accounts, get a 401. */
export async function requireAccount(): Promise<Account> {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to use friends");
  return { id: user.id, name: user.name };
}
