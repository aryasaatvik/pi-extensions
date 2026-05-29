import { describe, expect, it } from "vitest";

import { probeSearchRuntimeStatus } from "./runtime.ts";

describe("search runtime status", () => {
  it("reports the Pi-owned search DB path and SQLite capabilities", () => {
    const status = probeSearchRuntimeStatus({
      dataDir: "/tmp/executor-data",
      sqlitePath: "/tmp/executor-data/data.db",
      searchDir: "/tmp/executor-data/pi-executor",
      searchSqlitePath: "/tmp/executor-data/pi-executor/search.db",
    });

    expect(status.searchSqlitePath).toBe("/tmp/executor-data/pi-executor/search.db");
    expect(status.fts5.available).toBe(true);
    expect(status.fts5.detail).toContain("FTS5");
    expect(status.sqliteVec.available, status.sqliteVec.detail).toBe(true);
    expect(status.sqliteVec.detail).toContain("sqlite-vec");
  });
});
