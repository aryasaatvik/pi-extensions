import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { globalAgentsDir, projectAgentsDir } from "../config/paths.ts";

export type AgentSource = "user" | "project" | "builtin";

export interface AgentConfig {
  name: string;
  description: string;
  /** Allowed tool names. Omitted = the default coding tool set. */
  tools?: string[];
  /** Model override as "provider/model-id". Omitted = inherit the parent's model. */
  model?: string;
  /** Markdown body; becomes the child agent's system prompt. */
  systemPrompt: string;
  source: AgentSource;
  filePath?: string;
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  if (!existsSync(dir)) return [];

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const out: AgentConfig[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;

    const filePath = join(dir, name);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      // Not a readable file (e.g. a directory named *.md) — skip.
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    out.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model?.trim() || undefined,
      systemPrompt: body.trim(),
      source,
      filePath,
    });
  }
  return out;
}

/** Discover markdown agent definitions. Project defs override global ones by name. */
export function discoverAgents(cwd: string): AgentConfig[] {
  const byName = new Map<string, AgentConfig>();
  for (const a of loadAgentsFromDir(globalAgentsDir(), "user")) byName.set(a.name, a);
  for (const a of loadAgentsFromDir(projectAgentsDir(cwd), "project")) byName.set(a.name, a);
  return [...byName.values()];
}
