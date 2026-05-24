import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Layer } from "effect";

import { ConfigService } from "../services/config.ts";
import { ElicitationUiService } from "../services/elicitation-ui.ts";
import { ExecutionService } from "../services/execution.ts";
import { ExecutorHostService } from "../services/executor-host.ts";
import { ExecutorPiLoggerLayer } from "../services/logger.ts";
import { RenderService } from "../services/render.ts";
import { SearchService } from "../services/search.ts";
import { SessionStateService } from "../services/session-state.ts";

export type AppServices =
  | ConfigService
  | ElicitationUiService
  | ExecutionService
  | ExecutorHostService
  | RenderService
  | SearchService
  | SessionStateService;

export const makeAppLayer = (pi: ExtensionAPI): Layer.Layer<AppServices> =>
  Layer.mergeAll(
    ElicitationUiService.Default,
    ExecutionService.Default,
    ExecutorHostService.Default,
    RenderService.Default,
    SearchService.Default,
    SessionStateService.Default,
    ExecutorPiLoggerLayer,
  ).pipe(Layer.provideMerge(ConfigService.Default));
