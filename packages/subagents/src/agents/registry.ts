import { BUILTIN_AGENTS } from "./builtins.ts";
import { type AgentConfig, discoverAgents } from "./discovery.ts";

/**
 * All agents available in `cwd`, with precedence builtin < user < project.
 * (discoverAgents already merges user < project.)
 */
export function listAgents(cwd: string): AgentConfig[] {
  const byName = new Map<string, AgentConfig>();
  for (const a of BUILTIN_AGENTS) byName.set(a.name, a);
  for (const a of discoverAgents(cwd)) byName.set(a.name, a);
  return [...byName.values()];
}

export function resolveAgent(cwd: string, name: string): AgentConfig | undefined {
  return listAgents(cwd).find((a) => a.name === name);
}
