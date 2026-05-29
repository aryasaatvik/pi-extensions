import { describe, expect, it } from "vitest";

import { projectToolSearchDocument } from "./documents.ts";

describe("tool search documents", () => {
  it("projects Executor tool metadata into a stable search document", () => {
    const document = projectToolSearchDocument(
      {
        id: "github.issues.create",
        sourceId: "github",
        pluginId: "mcp",
        name: "createIssue",
        description: "Create a GitHub issue",
      },
      {
        schema: {
          name: "createIssue",
          description: "Create issue with title and body",
          inputTypeScript: "{ title: string; body?: string }",
          outputTypeScript: "{ id: number; url: string }",
          typeScriptDefinitions: { Issue: "{ id: number }" },
        },
        source: {
          id: "github",
          name: "GitHub",
          kind: "mcp",
          pluginId: "mcp",
          canRemove: true,
          canRefresh: true,
          canEdit: false,
          runtime: true,
          scopeId: "project-1234",
        },
      },
    );

    expect(document).toMatchObject({
      path: "github.issues.create",
      sourceId: "github",
      pluginId: "mcp",
      name: "createIssue",
      description: "Create issue with title and body",
      inputTypeScript: "{ title: string; body?: string }",
      outputTypeScript: "{ id: number; url: string }",
      sourceKind: "mcp",
      sourceScopeId: "project-1234",
      sourceRuntime: true,
      disabled: false,
    });
    expect(document.searchText).toContain("github.issues.create");
    expect(document.searchText).toContain("Create issue with title and body");
    expect(document.embeddingText).toContain("Create issue with title and body");
    expect(document.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
