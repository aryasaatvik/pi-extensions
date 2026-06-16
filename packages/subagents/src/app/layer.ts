import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Layer } from "effect";

import { SubagentsConfigService } from "../services/config.ts";
import { JobsService } from "../services/jobs.ts";
import { SpawnService } from "../services/spawn.ts";

export type AppServices = SubagentsConfigService | SpawnService | JobsService;

export const makeAppLayer = (pi: ExtensionAPI): Layer.Layer<AppServices> =>
  Layer.mergeAll(SubagentsConfigService.Default, SpawnService.Default, JobsService.layer(pi));
