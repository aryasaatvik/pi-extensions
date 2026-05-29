import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolvedExecutorStorage {
  readonly dataDir: string;
  readonly sqlitePath: string;
  readonly searchDir: string;
  readonly searchSqlitePath: string;
}

export const resolveExecutorStorage = (): ResolvedExecutorStorage => {
  const dataDir = process.env.EXECUTOR_DATA_DIR ?? join(homedir(), ".executor");
  const searchDir = join(dataDir, "pi-executor");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(searchDir, { recursive: true });

  return {
    dataDir,
    sqlitePath: join(dataDir, "data.db"),
    searchDir,
    searchSqlitePath: join(searchDir, "search.db"),
  };
};
