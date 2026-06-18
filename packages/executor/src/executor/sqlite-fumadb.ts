import { fumadb, type FumaDB } from "@executor-js/fumadb";
import {
  createDrizzleRuntimeSchemaFromTables,
  createDrizzleRuntimeSchemaSqlFromTables,
  drizzleAdapter,
} from "@executor-js/fumadb/adapters/drizzle";
import { schema as fumaSchema, type RelationsMap } from "@executor-js/fumadb/schema";
import type { AnyTable } from "@executor-js/fumadb/schema";
import type { AbstractQuery } from "@executor-js/fumadb/query";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type FumaTables = Record<string, AnyTable>;
type FumaDb<TSchema extends ReturnType<typeof fumaSchema> = ReturnType<typeof fumaSchema>> =
  AbstractQuery<TSchema>;

type SqliteFumaSchema<TTables extends FumaTables> = ReturnType<
  typeof fumaSchema<string, TTables, RelationsMap<TTables>>
>;

export interface SqliteFumaDb<TTables extends FumaTables = FumaTables> {
  readonly db: FumaDb<SqliteFumaSchema<TTables>>;
  readonly fuma: FumaDB<SqliteFumaSchema<TTables>[]>;
  readonly drizzle: unknown;
  readonly sqlite: {
    readonly close: () => void;
  };
  readonly close: () => Promise<void>;
}

export interface CreateSqliteFumaDbOptions<TTables extends FumaTables = FumaTables> {
  readonly tables: TTables;
  readonly namespace: string;
  readonly version?: string;
  readonly path: string;
}

const openSqlite = async (
  path: string,
  schema: Record<string, unknown>,
): Promise<{
  readonly sqlite: { readonly exec: (statement: string) => unknown; readonly close: () => void };
  readonly drizzleDb: unknown;
}> => {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const { drizzle } =
    require("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  return {
    sqlite,
    drizzleDb: drizzle(sqlite, { schema }),
  };
};

export const createSqliteFumaDb = async <const TTables extends FumaTables>(
  options: CreateSqliteFumaDbOptions<TTables>,
): Promise<SqliteFumaDb<TTables>> => {
  const version = options.version ?? "1.0.0";
  const schema = createDrizzleRuntimeSchemaFromTables({
    tables: options.tables,
    namespace: options.namespace,
    version,
    provider: "sqlite",
  });
  const { sqlite, drizzleDb } = await openSqlite(options.path, schema);

  for (const statement of createDrizzleRuntimeSchemaSqlFromTables({
    tables: options.tables,
    namespace: options.namespace,
    version,
    provider: "sqlite",
  })) {
    sqlite.exec(statement);
  }

  const latestSchema = fumaSchema({
    version,
    tables: options.tables,
  });
  const factory = fumadb({
    namespace: options.namespace,
    schemas: [latestSchema],
  });
  const fuma = factory.client(
    drizzleAdapter({
      db: drizzleDb,
      provider: "sqlite",
    }),
  );

  return {
    db: fuma.orm(version),
    fuma,
    drizzle: drizzleDb,
    sqlite,
    close: async () => {
      sqlite.close();
    },
  };
};
