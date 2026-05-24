import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const EXECUTOR_PI_CONFIG_FILE = "executor-pi.json";

export const globalExecutorPiConfigPath = (): string =>
  join(getAgentDir(), EXECUTOR_PI_CONFIG_FILE);

export const projectExecutorPiConfigPath = (cwd: string): string =>
  join(cwd, ".pi", EXECUTOR_PI_CONFIG_FILE);
