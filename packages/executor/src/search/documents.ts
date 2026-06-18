import { createHash } from "node:crypto";

import type { Integration, Tool } from "@executor-js/sdk/core";

const ADDRESS_PREFIX = "tools.";

/** Strip the `tools.` proxy prefix to get the callable path. */
const addressToPath = (address: string): string =>
  address.startsWith(ADDRESS_PREFIX) ? address.slice(ADDRESS_PREFIX.length) : address;

export interface ToolSearchDocument {
  readonly path: string;
  readonly sourceId: string;
  readonly pluginId: string;
  readonly name: string;
  readonly description: string;
  readonly inputTypeScript: string | null;
  readonly outputTypeScript: string | null;
  readonly typeDefinitionsJson: string | null;
  readonly sourceKind: string | null;
  readonly sourceScopeId: string | null;
  readonly sourceRuntime: boolean | null;
  readonly disabled: boolean;
  readonly searchText: string;
  readonly embeddingText: string;
  readonly fingerprint: string;
}

export interface ToolSearchSchemaDetails {
  readonly name?: string;
  readonly description?: string;
  readonly inputTypeScript?: string;
  readonly outputTypeScript?: string;
  readonly typeScriptDefinitions?: Record<string, string>;
}

const stableJson = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, Object.keys(value as object).sort());
};

const joinSearchText = (parts: ReadonlyArray<string | null | undefined>): string =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n");

const fingerprintDocument = (input: Omit<ToolSearchDocument, "fingerprint">): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        path: input.path,
        sourceId: input.sourceId,
        pluginId: input.pluginId,
        name: input.name,
        description: input.description,
        inputTypeScript: input.inputTypeScript,
        outputTypeScript: input.outputTypeScript,
        typeDefinitionsJson: input.typeDefinitionsJson,
        sourceKind: input.sourceKind,
        sourceScopeId: input.sourceScopeId,
        sourceRuntime: input.sourceRuntime,
        disabled: input.disabled,
        searchText: input.searchText,
      }),
    )
    .digest("hex");

export const projectToolSearchDocument = (
  tool: Tool,
  options?: {
    readonly schema?: ToolSearchSchemaDetails | null;
    readonly integration?: Integration;
    readonly disabled?: boolean;
  },
): ToolSearchDocument => {
  const path = addressToPath(String(tool.address));
  const integration = String(tool.integration);
  const schema = options?.schema ?? null;
  const typeDefinitionsJson = stableJson(schema?.typeScriptDefinitions);
  const inputTypeScript = schema?.inputTypeScript ?? null;
  const outputTypeScript = schema?.outputTypeScript ?? null;
  const searchText = joinSearchText([
    path,
    integration,
    tool.pluginId,
    String(tool.name),
    schema?.name,
    schema?.description,
    tool.description,
    inputTypeScript,
    outputTypeScript,
    typeDefinitionsJson,
    options?.integration?.kind,
    options?.integration?.description,
  ]);
  const embeddingText = joinSearchText([
    `${path} ${String(tool.name)}`,
    schema?.description,
    tool.description,
    inputTypeScript,
    outputTypeScript,
    typeDefinitionsJson,
  ]);
  const base = {
    path,
    sourceId: integration,
    pluginId: tool.pluginId,
    name: schema?.name ?? String(tool.name),
    description: schema?.description ?? tool.description,
    inputTypeScript,
    outputTypeScript,
    typeDefinitionsJson,
    sourceKind: options?.integration?.kind ?? null,
    sourceScopeId: null,
    sourceRuntime: null,
    disabled: options?.disabled ?? false,
    searchText,
    embeddingText,
  } satisfies Omit<ToolSearchDocument, "fingerprint">;

  return {
    ...base,
    fingerprint: fingerprintDocument(base),
  };
};
