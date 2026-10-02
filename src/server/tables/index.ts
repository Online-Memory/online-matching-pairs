import "server-only";

import { getDb } from "@/server/db";

import { TableService } from "./service";

export * from "./service";

let service: Promise<TableService> | undefined;

export function getTableService(): Promise<TableService> {
  service ??= getDb().then((db) => new TableService(db));
  return service;
}
