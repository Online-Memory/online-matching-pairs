import "server-only";

import { getDb } from "@/server/db";

import { ProgressService } from "./service";

export * from "./service";

let service: Promise<ProgressService> | undefined;

export function getProgressService(): Promise<ProgressService> {
  service ??= getDb().then((db) => new ProgressService(db));
  return service;
}
