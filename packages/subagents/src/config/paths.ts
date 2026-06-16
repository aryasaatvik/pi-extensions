import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PI_SUBAGENTS_CONFIG_FILE = "pi-subagents.json";

export const globalSubagentsConfigPath = (): string =>
  join(getAgentDir(), PI_SUBAGENTS_CONFIG_FILE);

export const projectSubagentsConfigPath = (cwd: string): string =>
  join(cwd, ".pi", PI_SUBAGENTS_CONFIG_FILE);

/** Markdown agent-definition directories. Project overrides global. */
export const globalAgentsDir = (): string => join(getAgentDir(), "agents");

export const projectAgentsDir = (cwd: string): string => join(cwd, ".pi", "agents");
