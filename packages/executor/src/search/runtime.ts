import { resolveExecutorStorage, type ResolvedExecutorStorage } from "../executor/storage.ts";
import {
  loadSqliteVecExtension,
  openSearchSqliteDatabase,
  type SearchSqliteDatabase,
} from "./sqlite.ts";

export interface SearchCapability {
  readonly available: boolean;
  readonly detail: string;
}

export interface SearchRuntimeStatus {
  readonly searchDir: string;
  readonly searchSqlitePath: string;
  readonly fts5: SearchCapability;
  readonly sqliteVec: SearchCapability;
}

const ok = (detail: string): SearchCapability => ({
  available: true,
  detail,
});

const unavailable = (cause: unknown): SearchCapability => ({
  available: false,
  detail: cause instanceof Error ? cause.message : String(cause),
});

const probeFts5 = (db: SearchSqliteDatabase): SearchCapability => {
  try {
    db.exec("CREATE VIRTUAL TABLE temp.__executor_pi_fts_probe USING fts5(value)");
    db.exec("DROP TABLE temp.__executor_pi_fts_probe");
    return ok("FTS5 virtual tables are available");
  } catch (cause) {
    return unavailable(cause);
  }
};

const probeSqliteVec = (db: SearchSqliteDatabase): SearchCapability => {
  try {
    loadSqliteVecExtension(db);
    const row = db.prepare("SELECT vec_version() AS version").get() as
      | { readonly version?: unknown }
      | undefined;
    if (typeof row?.version !== "string" || row.version.length === 0) {
      throw new Error("vec_version() returned no version");
    }
    return ok(`sqlite-vec ${row.version}`);
  } catch (cause) {
    return unavailable(cause);
  }
};

export const probeSearchRuntimeStatus = (
  storage: ResolvedExecutorStorage = resolveExecutorStorage(),
): SearchRuntimeStatus => {
  const db = openSearchSqliteDatabase(":memory:");
  try {
    return {
      searchDir: storage.searchDir,
      searchSqlitePath: storage.searchSqlitePath,
      fts5: probeFts5(db),
      sqliteVec: probeSqliteVec(db),
    };
  } finally {
    db.close();
  }
};
