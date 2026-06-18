import { describe, expect, it } from "vitest";

import { projectToolSearchDocument } from "./documents.ts";

describe("tool search documents", () => {
  it("projects Executor tool metadata into a stable search document", () => {
    const document = projectToolSearchDocument(
      {
        address: "tools.github.org.main.issues.create" as never,
        integration: "github" as never,
        connection: "main" as never,
        owner: "org" as never,
        pluginId: "mcp",
        name: "createIssue" as never,
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
        integration: {
          slug: "github" as never,
          description: "GitHub",
          kind: "mcp",
          canRemove: true,
          canRefresh: true,
          authMethods: [],
        },
      },
    );

    expect(document).toMatchObject({
      path: "github.org.main.issues.create",
      sourceId: "github",
      pluginId: "mcp",
      name: "createIssue",
      description: "Create issue with title and body",
      inputTypeScript: "{ title: string; body?: string }",
      outputTypeScript: "{ id: number; url: string }",
      sourceKind: "mcp",
      sourceScopeId: null,
      sourceRuntime: null,
      disabled: false,
    });
    expect(document.searchText).toContain("github.org.main.issues.create");
    expect(document.searchText).toContain("Create issue with title and body");
    expect(document.embeddingText).toContain("Create issue with title and body");
    expect(document.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
