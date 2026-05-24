import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolvedExecutorStorage {
  readonly dataDir: string;
  readonly sqlitePath: string;
}

export const resolveExecutorStorage = (): ResolvedExecutorStorage => {
  const dataDir = process.env.EXECUTOR_DATA_DIR ?? join(homedir(), ".executor");
  mkdirSync(dataDir, { recursive: true });

  return {
    dataDir,
    sqlitePath: join(dataDir, "data.db"),
  };
};
