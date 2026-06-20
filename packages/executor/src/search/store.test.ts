import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  completeSearchIndexRun,
  countSearchDocuments,
  countSearchEmbeddings,
  failSearchIndexRun,
  getSearchIndexStatus,
  getStaleEmbeddingDocuments,
  inspectSearchDocument,
  openSearchStore,
  reconcileToolDocuments,
  replaceToolDocuments,
  searchToolDocuments,
  startSearchIndexRun,
  upsertSearchEmbeddings,
} from "./store.ts";
import type { ToolSearchDocument } from "./documents.ts";
import {
  makeTestSearchEmbeddingProvider,
  TestSearchEmbeddingDimensions,
} from "./test-embeddings.ts";

const workspaces = new Set<string>();

const makeDbPath = (): string => {
  const workspace = mkdtempSync(join(tmpdir(), "executor-pi-search-store-"));
  workspaces.add(workspace);
  return join(workspace, "search.db");
};

afterEach(() => {
  for (const workspace of workspaces) {
    workspaces.delete(workspace);
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("search store", () => {
  const document = (input: {
    readonly path: string;
    readonly sourceId: string;
    readonly name: string;
    readonly description: string;
    readonly disabled?: boolean;
  }): ToolSearchDocument => ({
    path: input.path,
    sourceId: input.sourceId,
    pluginId: "mcp",
    name: input.name,
    description: input.description,
    inputTypeScript: "{ input: string }",
    outputTypeScript: "{ ok: true }",
    typeDefinitionsJson: null,
    sourceKind: "mcp",
    sourceScopeId: "project-1234",
    sourceRuntime: true,
    disabled: input.disabled ?? false,
    searchText: [input.path, input.sourceId, input.name, input.description].join("\n"),
    embeddingText: [input.path, input.name, input.description].join("\n"),
    fingerprint: `${input.path}:fingerprint`,
  });

  it("creates the Pi-owned search schema and replaces indexed tool documents", () => {
    const store = openSearchStore(makeDbPath());
    try {
      replaceToolDocuments(store.db, [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create a GitHub issue",
        }),
      ]);

      expect(countSearchDocuments(store.db)).toBe(1);
      expect(countSearchEmbeddings(store.db)).toBe(0);
      const fts = store.db
        .prepare("SELECT path FROM search_documents_fts WHERE search_documents_fts MATCH ?")
        .all("github") as Array<{ readonly path: string }>;

      expect(fts).toEqual([{ path: "github.issues.create" }]);
      expect(
        searchToolDocuments(store.db, {
          query: "github issue",
          namespace: "github",
          limit: 5,
          offset: 0,
        }),
      ).toMatchObject({
        items: [
          {
            path: "github.issues.create",
            name: "createIssue",
            description: "Create a GitHub issue",
            integration: "github",
          },
        ],
        total: 1,
        hasMore: false,
        nextOffset: null,
      });

      replaceToolDocuments(store.db, []);

      expect(countSearchDocuments(store.db)).toBe(0);
    } finally {
      store.close();
    }
  });

  it("keeps FTS ranking stable for overlapping names and descriptions", () => {
    const store = openSearchStore(makeDbPath());
    try {
      replaceToolDocuments(store.db, [
        document({
          path: "calendar.events.create",
          sourceId: "calendar",
          name: "createEvent",
          description: "Create a calendar event with attendees",
        }),
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create an issue and mention a calendar event",
        }),
        document({
          path: "calendar.events.delete",
          sourceId: "calendar",
          name: "deleteEvent",
          description: "Delete a calendar event",
        }),
      ]);

      const result = searchToolDocuments(store.db, {
        query: "create calendar event",
        limit: 3,
        offset: 0,
      });

      expect(result.items.map((item) => item.path)).toEqual([
        "calendar.events.create",
        "github.issues.create",
      ]);
    } finally {
      store.close();
    }
  });

  it("paginates deterministically", () => {
    const store = openSearchStore(makeDbPath());
    try {
      replaceToolDocuments(store.db, [
        document({
          path: "alpha.search",
          sourceId: "alpha",
          name: "search",
          description: "shared search tool",
        }),
        document({
          path: "beta.search",
          sourceId: "beta",
          name: "search",
          description: "shared search tool",
        }),
        document({
          path: "gamma.search",
          sourceId: "gamma",
          name: "search",
          description: "shared search tool",
        }),
      ]);

      const first = searchToolDocuments(store.db, { query: "search", limit: 2, offset: 0 });
      const second = searchToolDocuments(store.db, {
        query: "search",
        limit: 2,
        offset: first.nextOffset ?? 0,
      });

      expect(first.total).toBe(3);
      expect(first.hasMore).toBe(true);
      expect(first.nextOffset).toBe(2);
      expect(first.items.map((item) => item.path)).toEqual(["alpha.search", "beta.search"]);
      expect(second.hasMore).toBe(false);
      expect(second.nextOffset).toBeNull();
      expect(second.items.map((item) => item.path)).toEqual(["gamma.search"]);
    } finally {
      store.close();
    }
  });

  it("filters by namespace and disabled state", () => {
    const store = openSearchStore(makeDbPath());
    try {
      replaceToolDocuments(store.db, [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
        document({
          path: "linear.issues.create",
          sourceId: "linear",
          name: "createIssue",
          description: "Create issue",
        }),
        document({
          path: "github.issues.delete",
          sourceId: "github",
          name: "deleteIssue",
          description: "Delete issue",
          disabled: true,
        }),
      ]);

      const result = searchToolDocuments(store.db, {
        query: "issue",
        namespace: "github",
        limit: 10,
        offset: 0,
      });

      expect(result.items.map((item) => item.path)).toEqual(["github.issues.create"]);
      expect(result.total).toBe(1);
    } finally {
      store.close();
    }
  });

  it("returns an empty page for blank or unmatched queries", () => {
    const store = openSearchStore(makeDbPath());
    try {
      replaceToolDocuments(store.db, [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
      ]);

      expect(searchToolDocuments(store.db, { query: "", limit: 10, offset: 0 })).toEqual({
        items: [],
        total: 0,
        hasMore: false,
        nextOffset: null,
      });
      expect(searchToolDocuments(store.db, { query: "calendar", limit: 10, offset: 0 })).toEqual({
        items: [],
        total: 0,
        hasMore: false,
        nextOffset: null,
      });
    } finally {
      store.close();
    }
  });

  it("tracks search index run status and source fingerprints", () => {
    const store = openSearchStore(makeDbPath());
    try {
      const runId = startSearchIndexRun(store.db);
      replaceToolDocuments(store.db, [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
      ]);
      completeSearchIndexRun(store.db, runId);

      expect(getSearchIndexStatus(store.db)).toMatchObject({
        status: "completed",
        documentCount: 1,
        sourceCount: 1,
        embeddingCount: 0,
        error: null,
      });

      const failedRunId = startSearchIndexRun(store.db);
      failSearchIndexRun(store.db, failedRunId, "boom");

      expect(getSearchIndexStatus(store.db)).toMatchObject({
        status: "failed",
        documentCount: 1,
        sourceCount: 1,
        error: "boom",
      });
    } finally {
      store.close();
    }
  });

  it("stores sqlite-vec embeddings and blends hybrid ranking with lexical results", async () => {
    const store = openSearchStore(makeDbPath());
    try {
      const provider = makeTestSearchEmbeddingProvider();
      const documents = [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
        document({
          path: "calendar.events.create",
          sourceId: "calendar",
          name: "createEvent",
          description: "Schedule meeting with attendees",
        }),
      ];
      replaceToolDocuments(store.db, documents);
      const vectors = await Effect.runPromise(
        provider.embedDocuments(documents.map((item) => item.embeddingText)),
      );
      upsertSearchEmbeddings(store.db, {
        provider: provider.provider,
        model: provider.model,
        dimensions: TestSearchEmbeddingDimensions,
        documents,
        vectors,
      });

      expect(countSearchEmbeddings(store.db)).toBe(2);
      expect(inspectSearchDocument(store.db, "github.issues.create")).toMatchObject({
        path: "github.issues.create",
        embeddingModel: provider.model,
        embeddingDimensions: TestSearchEmbeddingDimensions,
      });

      const queryVector = await Effect.runPromise(provider.embedQuery("schedule meeting"));
      const result = searchToolDocuments(store.db, {
        query: "create",
        mode: "hybrid",
        queryVector,
        limit: 2,
        offset: 0,
      });

      expect(result.items.map((item) => item.path)).toContain("calendar.events.create");
      expect(result.total).toBe(2);
    } finally {
      store.close();
    }
  });

  it("reconciles documents without dropping unchanged embeddings", async () => {
    const store = openSearchStore(makeDbPath(), {
      embeddingDimensions: TestSearchEmbeddingDimensions,
    });
    try {
      const provider = makeTestSearchEmbeddingProvider();
      const documents = [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
        document({
          path: "calendar.events.create",
          sourceId: "calendar",
          name: "createEvent",
          description: "Schedule meeting",
        }),
      ];
      replaceToolDocuments(store.db, documents);
      const vectors = await Effect.runPromise(
        provider.embedDocuments(documents.map((item) => item.embeddingText)),
      );
      upsertSearchEmbeddings(store.db, {
        provider: provider.provider,
        model: provider.model,
        dimensions: TestSearchEmbeddingDimensions,
        documents,
        vectors,
      });

      const unchanged = reconcileToolDocuments(store.db, documents);

      expect(unchanged.changedDocuments).toEqual([]);
      expect(unchanged.removedPaths).toEqual([]);
      expect(countSearchDocuments(store.db)).toBe(2);
      expect(countSearchEmbeddings(store.db)).toBe(2);
      expect(getStaleEmbeddingDocuments(store.db, documents, provider)).toEqual([]);

      const changedCalendar = {
        ...documents[1]!,
        description: "Schedule meeting with attendees",
        searchText:
          "calendar.events.create\ncalendar\ncreateEvent\nSchedule meeting with attendees",
        embeddingText: "calendar.events.create\ncreateEvent\nSchedule meeting with attendees",
        fingerprint: "calendar.events.create:fingerprint:changed",
      };
      const changed = reconcileToolDocuments(store.db, [documents[0]!, changedCalendar]);

      expect(changed.changedDocuments.map((item) => item.path)).toEqual(["calendar.events.create"]);
      expect(countSearchEmbeddings(store.db)).toBe(1);
      expect(
        getStaleEmbeddingDocuments(store.db, [documents[0]!, changedCalendar], provider).map(
          (item) => item.path,
        ),
      ).toEqual(["calendar.events.create"]);
    } finally {
      store.close();
    }
  });

  it("removes deleted documents and their embeddings during reconcile", async () => {
    const store = openSearchStore(makeDbPath(), {
      embeddingDimensions: TestSearchEmbeddingDimensions,
    });
    try {
      const provider = makeTestSearchEmbeddingProvider();
      const documents = [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
        document({
          path: "calendar.events.create",
          sourceId: "calendar",
          name: "createEvent",
          description: "Schedule meeting",
        }),
      ];
      replaceToolDocuments(store.db, documents);
      const vectors = await Effect.runPromise(
        provider.embedDocuments(documents.map((item) => item.embeddingText)),
      );
      upsertSearchEmbeddings(store.db, {
        provider: provider.provider,
        model: provider.model,
        dimensions: TestSearchEmbeddingDimensions,
        documents,
        vectors,
      });

      const result = reconcileToolDocuments(store.db, [documents[0]!]);

      expect(result.removedPaths).toEqual(["calendar.events.create"]);
      expect(countSearchDocuments(store.db)).toBe(1);
      expect(countSearchEmbeddings(store.db)).toBe(1);
      expect(inspectSearchDocument(store.db, "calendar.events.create")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("recreates sqlite-vec storage when embedding dimensions change", async () => {
    const dbPath = makeDbPath();
    const first = openSearchStore(dbPath, { embeddingDimensions: 3 });
    try {
      const documents = [
        document({
          path: "github.issues.create",
          sourceId: "github",
          name: "createIssue",
          description: "Create issue",
        }),
      ];
      replaceToolDocuments(first.db, documents);
      upsertSearchEmbeddings(first.db, {
        provider: "test-hash",
        model: "test-3",
        dimensions: 3,
        documents,
        vectors: [[1, 0, 0]],
      });
      expect(countSearchEmbeddings(first.db)).toBe(1);
    } finally {
      first.close();
    }

    const second = openSearchStore(dbPath, { embeddingDimensions: 4 });
    try {
      expect(countSearchEmbeddings(second.db)).toBe(0);
      replaceToolDocuments(second.db, [
        document({
          path: "calendar.events.create",
          sourceId: "calendar",
          name: "createEvent",
          description: "Create event",
        }),
      ]);
      upsertSearchEmbeddings(second.db, {
        provider: "test-hash",
        model: "test-4",
        dimensions: 4,
        documents: [
          document({
            path: "calendar.events.create",
            sourceId: "calendar",
            name: "createEvent",
            description: "Create event",
          }),
        ],
        vectors: [[1, 0, 0, 0]],
      });
      expect(countSearchEmbeddings(second.db)).toBe(1);
    } finally {
      second.close();
    }
  });
});
