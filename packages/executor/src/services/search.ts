import { describeTool, searchTools } from "@executor-js/execution/core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer } from "effect";

import { ExecutionError } from "../errors.ts";
import type { SearchDetails, SearchInput, SearchResultItem } from "../schemas/search.ts";
import { ConfigService } from "./config.ts";
import { ExecutorHostService } from "./executor-host.ts";

export interface SearchRequest {
  readonly input: SearchInput;
  readonly ctx: ExtensionContext;
}

export interface SearchResponse {
  readonly text: string;
  readonly details: SearchDetails;
}

const defaultLimit = 12;
const defaultOffset = 0;

const formatSearchResponse = (details: SearchDetails): string => JSON.stringify(details, null, 2);

export class SearchService extends Context.Service<
  SearchService,
  {
    readonly search: (
      request: SearchRequest,
    ) => Effect.Effect<SearchResponse, ExecutionError, ConfigService | ExecutorHostService>;
  }
>()("SearchService") {
  static readonly Default = Layer.succeed(this)({
    search: (request) =>
      Effect.gen(function* () {
        const config = yield* ConfigService;
        const hosts = yield* ExecutorHostService;
        const host = yield* hosts.get(request.ctx.cwd).pipe(
          Effect.mapError(
            (cause) =>
              new ExecutionError({
                message: cause.message,
                cause,
              }),
          ),
        );
        const limit = request.input.limit ?? defaultLimit;
        const offset = request.input.offset ?? defaultOffset;
        const result = yield* searchTools(host.executor, request.input.query, limit, {
          namespace: request.input.namespace,
          offset,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ExecutionError({
                message: "Executor tool search failed.",
                cause,
              }),
          ),
        );
        const resolved = yield* config.resolve(request.ctx.cwd);
        const includeDetails =
          request.input.includeDetails ?? resolved.settings.search.defaultIncludeDetails;
        const items = includeDetails
          ? yield* Effect.all(
              result.items.map((item) =>
                describeTool(host.executor, item.path).pipe(
                  Effect.map(
                    (details) =>
                      ({
                        ...item,
                        details,
                      }) satisfies SearchResultItem,
                  ),
                  Effect.mapError(
                    (cause) =>
                      new ExecutionError({
                        message: `Executor tool description failed for ${item.path}.`,
                        cause,
                      }),
                  ),
                ),
              ),
              { concurrency: 4 },
            )
          : result.items;
        const details = {
          ...result,
          items,
        } satisfies SearchDetails;

        return {
          text: formatSearchResponse(details),
          details,
        };
      }),
  });
}
