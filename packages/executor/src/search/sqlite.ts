import { createRequire } from "node:module";

import type Database from "better-sqlite3";

const require = createRequire(import.meta.url);

export type SearchSqliteDatabase = Database.Database;

export const openSearchSqliteDatabase = (path: string): SearchSqliteDatabase => {
  const DatabaseCtor = require("better-sqlite3") as typeof import("better-sqlite3");
  return new DatabaseCtor(path);
};

export const loadSqliteVecExtension = (db: SearchSqliteDatabase): void => {
  const sqliteVec = require("sqlite-vec") as typeof import("sqlite-vec");
  sqliteVec.load(db);
};
