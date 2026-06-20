import { createHash } from "node:crypto";

import type { PagedResult, ToolDiscoveryResult } from "@executor-js/execution";

import type { ToolSearchDocument } from "./documents.ts";
import {
  searchEmbeddingTextHash,
  vectorToSql,
  type SearchEmbeddingProvider,
} from "./embeddings.ts";
import {
  loadSqliteVecExtension,
  openSearchSqliteDatabase,
  type SearchSqliteDatabase,
} from "./sqlite.ts";

export interface SearchStore {
  readonly db: SearchSqliteDatabase;
  readonly path: string;
  readonly embeddingDimensions: number;
  readonly close: () => void;
}

export type SearchRankingMode = "fts" | "hybrid";

export interface SearchDebugRow {
  readonly path: string;
  readonly sourceId: string;
  readonly name: string;
  readonly description: string;
  readonly searchText: string;
  readonly embeddingText: string;
  readonly fingerprint: string;
  readonly updatedAt: string;
  readonly embeddingModel: string | null;
  readonly embeddingDimensions: number | null;
  readonly embeddingUpdatedAt: string | null;
}

export interface SearchIndexStatus {
  readonly status: "never" | "running" | "completed" | "failed";
  readonly documentCount: number;
  readonly sourceCount: number;
  readonly embeddingCount: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly error: string | null;
}

export interface SearchIndexWriteResult {
  readonly changedDocuments: readonly ToolSearchDocument[];
  readonly removedPaths: readonly string[];
}

export const openSearchStore = (
  path: string,
  options: { readonly embeddingDimensions?: number } = {},
): SearchStore => {
  const db = openSearchSqliteDatabase(path);
  loadSqliteVecExtension(db);
  const embeddingDimensions = initializeSearchSchema(db, options.embeddingDimensions);
  return {
    db,
    path,
    embeddingDimensions,
    close: () => db.close(),
  };
};

const ensureSearchEmbeddingVectorTable = (
  db: SearchSqliteDatabase,
  dimensions: number | undefined,
): number => {
  const row = db.prepare("SELECT dimensions FROM search_embedding_config WHERE id = 1").get() as
    | { readonly dimensions?: unknown }
    | undefined;
  const existingDimensions = typeof row?.dimensions === "number" ? row.dimensions : null;
  const resolvedDimensions = dimensions ?? existingDimensions ?? 64;
  if (existingDimensions !== null && existingDimensions !== resolvedDimensions) {
    db.exec(`
      DROP TABLE IF EXISTS search_embedding_vectors;
      DELETE FROM search_embedding_rows;
      DELETE FROM search_embeddings;
      DELETE FROM search_embedding_config;
    `);
  }
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_embedding_vectors USING vec0(
      embedding float[${resolvedDimensions}]
    );
  `);
  db.prepare(
    `INSERT OR REPLACE INTO search_embedding_config (id, dimensions, updated_at)
     VALUES (1, ?, ?)`,
  ).run(resolvedDimensions, new Date().toISOString());
  return resolvedDimensions;
};

export const initializeSearchSchema = (
  db: SearchSqliteDatabase,
  embeddingDimensions?: number,
): number => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_documents (
      path TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      input_typescript TEXT,
      output_typescript TEXT,
      type_definitions_json TEXT,
      source_kind TEXT,
      source_scope_id TEXT,
      source_runtime INTEGER,
      disabled INTEGER NOT NULL DEFAULT 0,
      search_text TEXT NOT NULL,
      embedding_text TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
      path,
      source_id,
      plugin_id,
      name,
      description,
      schema_text,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS search_sources (
      source_id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      kind TEXT,
      scope_id TEXT,
      runtime INTEGER,
      disabled INTEGER NOT NULL DEFAULT 0,
      tool_count INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_index_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS search_embeddings (
      path TEXT PRIMARY KEY,
      text_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(path) REFERENCES search_documents(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_embedding_rows (
      path TEXT PRIMARY KEY,
      vector_rowid INTEGER NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS search_embedding_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dimensions INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return ensureSearchEmbeddingVectorTable(db, embeddingDimensions);
};

const toSqlBool = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

const hashJson = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const replaceSearchSources = (
  db: SearchSqliteDatabase,
  documents: readonly ToolSearchDocument[],
  indexedAt: string,
): void => {
  const bySource = new Map<
    string,
    {
      readonly sourceId: string;
      readonly pluginId: string;
      readonly kind: string | null;
      readonly scopeId: string | null;
      readonly runtime: boolean | null;
      readonly disabled: boolean;
      readonly paths: string[];
    }
  >();

  for (const document of documents) {
    const existing = bySource.get(document.sourceId);
    if (existing) {
      existing.paths.push(document.path);
      continue;
    }
    bySource.set(document.sourceId, {
      sourceId: document.sourceId,
      pluginId: document.pluginId,
      kind: document.sourceKind,
      scopeId: document.sourceScopeId,
      runtime: document.sourceRuntime,
      disabled: document.disabled,
      paths: [document.path],
    });
  }

  db.prepare("DELETE FROM search_sources").run();
  const insert = db.prepare(`
    INSERT INTO search_sources (
      source_id,
      plugin_id,
      kind,
      scope_id,
      runtime,
      disabled,
      tool_count,
      fingerprint,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const source of bySource.values()) {
    insert.run(
      source.sourceId,
      source.pluginId,
      source.kind,
      source.scopeId,
      toSqlBool(source.runtime),
      toSqlBool(source.disabled),
      source.paths.length,
      hashJson({
        sourceId: source.sourceId,
        pluginId: source.pluginId,
        kind: source.kind,
        scopeId: source.scopeId,
        runtime: source.runtime,
        disabled: source.disabled,
        paths: source.paths.toSorted(),
      }),
      indexedAt,
    );
  }
};

export const replaceToolDocuments = (
  db: SearchSqliteDatabase,
  documents: readonly ToolSearchDocument[],
): void => {
  const now = new Date().toISOString();
  const replaceDocument = db.prepare(`
    INSERT OR REPLACE INTO search_documents (
      path,
      source_id,
      plugin_id,
      name,
      description,
      input_typescript,
      output_typescript,
      type_definitions_json,
      source_kind,
      source_scope_id,
      source_runtime,
      disabled,
      search_text,
      embedding_text,
      fingerprint,
      updated_at
    ) VALUES (
      @path,
      @sourceId,
      @pluginId,
      @name,
      @description,
      @inputTypeScript,
      @outputTypeScript,
      @typeDefinitionsJson,
      @sourceKind,
      @sourceScopeId,
      @sourceRuntime,
      @disabled,
      @searchText,
      @embeddingText,
      @fingerprint,
      @updatedAt
    )
  `);
  const insertFts = db.prepare(`
    INSERT INTO search_documents_fts (
      path,
      source_id,
      plugin_id,
      name,
      description,
      schema_text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const removeMissing = db.prepare(
    documents.length === 0
      ? "DELETE FROM search_documents"
      : `DELETE FROM search_documents WHERE path NOT IN (${documents.map(() => "?").join(", ")})`,
  );
  const clearFts = db.prepare("DELETE FROM search_documents_fts");
  const clearEmbeddingRows = db.prepare("DELETE FROM search_embedding_rows");
  const clearEmbeddingVectors = db.prepare("DELETE FROM search_embedding_vectors");
  const clearEmbeddings = db.prepare("DELETE FROM search_embeddings");

  const write = db.transaction((items: readonly ToolSearchDocument[]) => {
    if (items.length === 0) {
      removeMissing.run();
    } else {
      removeMissing.run(...items.map((item) => item.path));
    }
    clearFts.run();
    clearEmbeddingRows.run();
    clearEmbeddingVectors.run();
    clearEmbeddings.run();
    for (const item of items) {
      replaceDocument.run({
        ...item,
        sourceRuntime: toSqlBool(item.sourceRuntime),
        disabled: toSqlBool(item.disabled),
        updatedAt: now,
      });
      insertFts.run(
        item.path,
        item.sourceId,
        item.pluginId,
        item.name,
        item.description,
        [item.inputTypeScript, item.outputTypeScript, item.typeDefinitionsJson]
          .filter((part): part is string => part !== null)
          .join("\n"),
      );
    }
    replaceSearchSources(db, items, now);
  });

  write(documents);
};

const deleteEmbeddingForPathStatements = (db: SearchSqliteDatabase) => {
  const rowForPath = db.prepare(
    "SELECT vector_rowid AS vectorRowid FROM search_embedding_rows WHERE path = ?",
  );
  const deleteVector = db.prepare("DELETE FROM search_embedding_vectors WHERE rowid = ?");
  const deleteMapping = db.prepare("DELETE FROM search_embedding_rows WHERE path = ?");
  const deleteMetadata = db.prepare("DELETE FROM search_embeddings WHERE path = ?");

  return (path: string): void => {
    const existing = rowForPath.get(path) as { readonly vectorRowid?: unknown } | undefined;
    if (typeof existing?.vectorRowid === "number") {
      deleteVector.run(existing.vectorRowid);
    }
    deleteMapping.run(path);
    deleteMetadata.run(path);
  };
};

export const reconcileToolDocuments = (
  db: SearchSqliteDatabase,
  documents: readonly ToolSearchDocument[],
): SearchIndexWriteResult => {
  const existingRows = db.prepare("SELECT path, fingerprint FROM search_documents").all() as {
    readonly path: string;
    readonly fingerprint: string;
  }[];
  const existingByPath = new Map(existingRows.map((row) => [row.path, row.fingerprint]));
  const currentPaths = new Set(documents.map((document) => document.path));
  const removedPaths = existingRows
    .map((row) => row.path)
    .filter((path) => !currentPaths.has(path));
  const changedDocuments = documents.filter(
    (document) => existingByPath.get(document.path) !== document.fingerprint,
  );

  const now = new Date().toISOString();
  const replaceDocument = db.prepare(`
    INSERT OR REPLACE INTO search_documents (
      path,
      source_id,
      plugin_id,
      name,
      description,
      input_typescript,
      output_typescript,
      type_definitions_json,
      source_kind,
      source_scope_id,
      source_runtime,
      disabled,
      search_text,
      embedding_text,
      fingerprint,
      updated_at
    ) VALUES (
      @path,
      @sourceId,
      @pluginId,
      @name,
      @description,
      @inputTypeScript,
      @outputTypeScript,
      @typeDefinitionsJson,
      @sourceKind,
      @sourceScopeId,
      @sourceRuntime,
      @disabled,
      @searchText,
      @embeddingText,
      @fingerprint,
      @updatedAt
    )
  `);
  const deleteFtsForPath = db.prepare("DELETE FROM search_documents_fts WHERE path = ?");
  const insertFts = db.prepare(`
    INSERT INTO search_documents_fts (
      path,
      source_id,
      plugin_id,
      name,
      description,
      schema_text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const deleteDocument = db.prepare("DELETE FROM search_documents WHERE path = ?");
  const deleteEmbeddingForPath = deleteEmbeddingForPathStatements(db);

  const write = db.transaction(() => {
    for (const path of removedPaths) {
      deleteFtsForPath.run(path);
      deleteEmbeddingForPath(path);
      deleteDocument.run(path);
    }

    for (const item of changedDocuments) {
      deleteFtsForPath.run(item.path);
      deleteEmbeddingForPath(item.path);
      replaceDocument.run({
        ...item,
        sourceRuntime: toSqlBool(item.sourceRuntime),
        disabled: toSqlBool(item.disabled),
        updatedAt: now,
      });
      insertFts.run(
        item.path,
        item.sourceId,
        item.pluginId,
        item.name,
        item.description,
        [item.inputTypeScript, item.outputTypeScript, item.typeDefinitionsJson]
          .filter((part): part is string => part !== null)
          .join("\n"),
      );
    }

    replaceSearchSources(db, documents, now);
  });

  write();
  return { changedDocuments, removedPaths };
};

export const countSearchDocuments = (db: SearchSqliteDatabase): number => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM search_documents").get() as
    | { readonly count?: unknown }
    | undefined;
  return typeof row?.count === "number" ? row.count : 0;
};

export const countSearchEmbeddings = (db: SearchSqliteDatabase): number => {
  const row = db.prepare("SELECT COUNT(*) AS count FROM search_embeddings").get() as
    | { readonly count?: unknown }
    | undefined;
  return typeof row?.count === "number" ? row.count : 0;
};

export const getStaleEmbeddingDocuments = (
  db: SearchSqliteDatabase,
  documents: readonly Pick<ToolSearchDocument, "path" | "embeddingText">[],
  provider: SearchEmbeddingProvider,
): readonly Pick<ToolSearchDocument, "path" | "embeddingText">[] => {
  const rowForPath = db.prepare(`
    SELECT
      e.text_hash AS textHash,
      e.model AS model,
      e.dimensions AS dimensions,
      r.vector_rowid AS vectorRowid
    FROM search_documents d
    LEFT JOIN search_embeddings e ON e.path = d.path
    LEFT JOIN search_embedding_rows r ON r.path = d.path
    WHERE d.path = ?
  `);

  return documents.filter((document) => {
    const row = rowForPath.get(document.path) as
      | {
          readonly textHash?: unknown;
          readonly model?: unknown;
          readonly dimensions?: unknown;
          readonly vectorRowid?: unknown;
        }
      | undefined;

    return (
      row?.textHash !==
        searchEmbeddingTextHash(document.embeddingText, provider.model, provider.provider) ||
      row.model !== provider.model ||
      row.dimensions !== provider.dimensions ||
      typeof row.vectorRowid !== "number"
    );
  });
};

export const upsertSearchEmbeddings = (
  db: SearchSqliteDatabase,
  input: {
    readonly provider: SearchEmbeddingProvider["provider"];
    readonly model: string;
    readonly dimensions: number;
    readonly documents: readonly Pick<ToolSearchDocument, "path" | "embeddingText">[];
    readonly vectors: readonly (readonly number[])[];
  },
): void => {
  const row = db.prepare("SELECT dimensions FROM search_embedding_config WHERE id = 1").get() as
    | { readonly dimensions?: unknown }
    | undefined;
  const configuredDimensions = typeof row?.dimensions === "number" ? row.dimensions : null;
  if (configuredDimensions !== input.dimensions) {
    throw new Error(
      `Search embeddings must have ${configuredDimensions ?? "configured"} dimensions; received ${input.dimensions}.`,
    );
  }
  if (input.documents.length !== input.vectors.length) {
    throw new Error("Search embedding document/vector count mismatch.");
  }

  const deleteRow = db.prepare("DELETE FROM search_embedding_vectors WHERE rowid = ?");
  const rowForPath = db.prepare(
    "SELECT vector_rowid AS vectorRowid FROM search_embedding_rows WHERE path = ?",
  );
  const deleteMapping = db.prepare("DELETE FROM search_embedding_rows WHERE path = ?");
  const insertVector = db.prepare("INSERT INTO search_embedding_vectors(embedding) VALUES (?)");
  const insertMapping = db.prepare(
    "INSERT INTO search_embedding_rows (path, vector_rowid) VALUES (?, ?)",
  );
  const insertMetadata = db.prepare(`
    INSERT OR REPLACE INTO search_embeddings (
      path,
      text_hash,
      model,
      dimensions,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const write = db.transaction(() => {
    const now = new Date().toISOString();
    for (let index = 0; index < input.documents.length; index++) {
      const document = input.documents[index]!;
      const existing = rowForPath.get(document.path) as
        | { readonly vectorRowid?: unknown }
        | undefined;
      if (typeof existing?.vectorRowid === "number") {
        deleteRow.run(existing.vectorRowid);
      }
      deleteMapping.run(document.path);

      const inserted = insertVector.run(vectorToSql(input.vectors[index]!));
      const vectorRowid = Number(inserted.lastInsertRowid);
      insertMapping.run(document.path, vectorRowid);
      insertMetadata.run(
        document.path,
        searchEmbeddingTextHash(document.embeddingText, input.model, input.provider),
        input.model,
        input.dimensions,
        now,
      );
    }
  });

  write();
};

export const startSearchIndexRun = (db: SearchSqliteDatabase): number => {
  const startedAt = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO search_index_runs (started_at, status) VALUES (?, 'running')")
    .run(startedAt);
  return Number(result.lastInsertRowid);
};

export const completeSearchIndexRun = (db: SearchSqliteDatabase, id: number): void => {
  db.prepare(
    "UPDATE search_index_runs SET completed_at = ?, status = 'completed', error = NULL WHERE id = ?",
  ).run(new Date().toISOString(), id);
};

export const failSearchIndexRun = (db: SearchSqliteDatabase, id: number, error: string): void => {
  db.prepare(
    "UPDATE search_index_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?",
  ).run(new Date().toISOString(), error, id);
};

export const getSearchIndexStatus = (db: SearchSqliteDatabase): SearchIndexStatus => {
  const run = db
    .prepare(
      `SELECT status, started_at AS startedAt, completed_at AS completedAt, error
       FROM search_index_runs
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get() as
    | {
        readonly status?: unknown;
        readonly startedAt?: unknown;
        readonly completedAt?: unknown;
        readonly error?: unknown;
      }
    | undefined;
  const sourceRow = db.prepare("SELECT COUNT(*) AS count FROM search_sources").get() as
    | { readonly count?: unknown }
    | undefined;

  return {
    status:
      run?.status === "running" || run?.status === "completed" || run?.status === "failed"
        ? run.status
        : "never",
    documentCount: countSearchDocuments(db),
    sourceCount: typeof sourceRow?.count === "number" ? sourceRow.count : 0,
    embeddingCount: countSearchEmbeddings(db),
    startedAt: typeof run?.startedAt === "string" ? run.startedAt : null,
    completedAt: typeof run?.completedAt === "string" ? run.completedAt : null,
    error: typeof run?.error === "string" ? run.error : null,
  };
};

export const hasUsableSearchIndex = (
  db: SearchSqliteDatabase,
  embeddingProvider: SearchEmbeddingProvider | null,
): boolean => {
  const status = getSearchIndexStatus(db);
  if (status.status !== "completed" || status.documentCount === 0) {
    return false;
  }
  if (!embeddingProvider) {
    return true;
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM search_embeddings
       WHERE model = ? AND dimensions = ?`,
    )
    .get(embeddingProvider.model, embeddingProvider.dimensions) as
    | { readonly count?: unknown }
    | undefined;

  return typeof row?.count === "number" && row.count > 0;
};

const normalizeSearchText = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase()
    .trim();

const toFtsQuery = (query: string): string | null => {
  const terms = normalizeSearchText(query)
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return terms.length === 0 ? null : terms.map((term) => `${term}*`).join(" ");
};

const emptyResult = (): PagedResult<ToolDiscoveryResult> => ({
  items: [],
  total: 0,
  hasMore: false,
  nextOffset: null,
});

interface RankedToolRow {
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly sourceId: string;
  readonly rank: number;
}

const toToolDiscoveryResult = (row: RankedToolRow): ToolDiscoveryResult => ({
  path: row.path,
  name: row.name,
  description: row.description,
  integration: row.sourceId,
  score: Math.max(0, Math.round(row.rank * 1_000)),
});

const paginateRows = (
  rows: readonly RankedToolRow[],
  offset: number,
  limit: number,
): PagedResult<ToolDiscoveryResult> => {
  const start = Math.min(Math.max(offset, 0), rows.length);
  const items = rows.slice(start, start + Math.max(0, limit)).map(toToolDiscoveryResult);
  const consumed = start + items.length;

  return {
    items,
    total: rows.length,
    hasMore: consumed < rows.length,
    nextOffset: consumed < rows.length ? consumed : null,
  };
};

const reciprocalRank = (rank: number, k = 60): number => 1 / (k + rank);

const mergeRankedRows = (
  lexicalRows: readonly RankedToolRow[],
  semanticRows: readonly RankedToolRow[],
): readonly RankedToolRow[] => {
  const byPath = new Map<string, RankedToolRow & { lexicalRank?: number; semanticRank?: number }>();
  lexicalRows.forEach((row, index) => byPath.set(row.path, { ...row, lexicalRank: index + 1 }));
  semanticRows.forEach((row, index) => {
    const existing = byPath.get(row.path);
    byPath.set(row.path, {
      ...(existing ?? row),
      semanticRank: index + 1,
    });
  });

  return [...byPath.values()]
    .map((row) => ({
      path: row.path,
      name: row.name,
      description: row.description,
      sourceId: row.sourceId,
      rank:
        (row.lexicalRank ? reciprocalRank(row.lexicalRank) * 0.7 : 0) +
        (row.semanticRank ? reciprocalRank(row.semanticRank) * 0.3 : 0),
    }))
    .toSorted((left, right) => right.rank - left.rank || left.path.localeCompare(right.path));
};

export const searchToolDocuments = (
  db: SearchSqliteDatabase,
  input: {
    readonly query: string;
    readonly namespace?: string;
    readonly limit: number;
    readonly offset: number;
    readonly mode?: SearchRankingMode;
    readonly queryVector?: readonly number[];
  },
): PagedResult<ToolDiscoveryResult> => {
  const ftsQuery = toFtsQuery(input.query);
  if (ftsQuery === null) return emptyResult();

  const limit = Math.max(0, Math.floor(input.limit));
  const offset = Math.max(0, Math.floor(input.offset));
  const candidateLimit = Math.max(limit + offset, 50);
  const namespace = input.namespace?.trim() || null;
  const namespacePrefix = namespace === null ? null : `${namespace}.%`;
  const filters = [
    "search_documents_fts MATCH @query",
    "d.disabled = 0",
    namespace === null ? "1 = 1" : "(d.source_id = @namespace OR d.path LIKE @namespacePrefix)",
  ].join(" AND ");
  const params = {
    query: ftsQuery,
    namespace,
    namespacePrefix,
    limit: candidateLimit,
  };
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count
    FROM search_documents_fts
    JOIN search_documents d ON d.path = search_documents_fts.path
    WHERE ${filters}`)
    .get(params) as { readonly count?: unknown } | undefined;
  const total = typeof totalRow?.count === "number" ? totalRow.count : 0;
  const lexicalRows = db
    .prepare(`SELECT
      d.path AS path,
      d.name AS name,
      d.description AS description,
      d.source_id AS sourceId,
      0 - bm25(search_documents_fts, 12.0, 8.0, 8.0, 10.0, 5.0, 3.0) AS rank
    FROM search_documents_fts
    JOIN search_documents d ON d.path = search_documents_fts.path
    WHERE ${filters}
    ORDER BY rank DESC, d.path ASC
    LIMIT @limit`)
    .all(params) as RankedToolRow[];

  if (input.mode !== "hybrid" || !input.queryVector || input.queryVector.length === 0) {
    const page = paginateRows(lexicalRows, offset, limit);
    const consumed = offset + page.items.length;
    return {
      ...page,
      total,
      hasMore: consumed < total,
      nextOffset: consumed < total ? consumed : null,
    };
  }

  const semanticRows = db
    .prepare(`SELECT
      d.path AS path,
      d.name AS name,
      d.description AS description,
      d.source_id AS sourceId,
      1.0 / (1.0 + v.distance) AS rank
    FROM search_embedding_vectors v
    JOIN search_embedding_rows r ON r.vector_rowid = v.rowid
    JOIN search_documents d ON d.path = r.path
    WHERE v.embedding MATCH @queryVector
      AND k = @limit
      AND d.disabled = 0
      AND ${namespace === null ? "1 = 1" : "(d.source_id = @namespace OR d.path LIKE @namespacePrefix)"}
    ORDER BY v.distance ASC, d.path ASC`)
    .all({
      queryVector: vectorToSql(input.queryVector),
      namespace,
      namespacePrefix,
      limit: candidateLimit,
    }) as RankedToolRow[];

  const merged = mergeRankedRows(lexicalRows, semanticRows);
  const page = paginateRows(merged, offset, limit);
  return { ...page, total: merged.length };
};

export const inspectSearchDocument = (
  db: SearchSqliteDatabase,
  path: string,
): SearchDebugRow | null => {
  const row = db
    .prepare(`SELECT
      d.path AS path,
      d.source_id AS sourceId,
      d.name AS name,
      d.description AS description,
      d.search_text AS searchText,
      d.embedding_text AS embeddingText,
      d.fingerprint AS fingerprint,
      d.updated_at AS updatedAt,
      e.model AS embeddingModel,
      e.dimensions AS embeddingDimensions,
      e.updated_at AS embeddingUpdatedAt
    FROM search_documents d
    LEFT JOIN search_embeddings e ON e.path = d.path
    WHERE d.path = ?`)
    .get(path) as SearchDebugRow | undefined;

  return row ?? null;
};
