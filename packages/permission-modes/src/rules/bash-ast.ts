import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

/**
 * Bash parsing via tree-sitter (the same stack opencode uses). Replaces regex
 * command-splitting so that command substitution, pipelines, subshells, and
 * env/wrapper prefixes are understood structurally rather than by string ops.
 *
 * The wasm runtime + grammar are loaded lazily once per process. Resolution
 * goes through each package's "exports" map via import.meta.resolve, so it works
 * under bun/node without a bundler step.
 *
 * There is intentionally NO regex fallback: a naive splitter can mis-decompose a
 * command and wrongly auto-allow it (e.g. `git status $(rm -rf /)`). If the
 * parser is unavailable, callers must fail safe (never auto-allow) instead.
 */

let parserPromise: Promise<Parser> | null = null;

async function initParser(): Promise<Parser> {
  const coreWasm = fileURLToPath(import.meta.resolve("web-tree-sitter/web-tree-sitter.wasm"));
  const bashWasm = fileURLToPath(import.meta.resolve("tree-sitter-bash/tree-sitter-bash.wasm"));
  await Parser.init({ locateFile: () => coreWasm });
  const bash = await Language.load(readFileSync(bashWasm));
  const parser = new Parser();
  parser.setLanguage(bash);
  return parser;
}

function getParser(): Promise<Parser> {
  if (!parserPromise) parserPromise = initParser();
  return parserPromise;
}

/** Warm the parser ahead of first use. Returns true if it initialized. */
export async function warmBashParser(): Promise<boolean> {
  try {
    await getParser();
    return true;
  } catch {
    return false;
  }
}

export interface BashAnalysis {
  /** Text of every `command` node, including those nested in substitutions/pipes. */
  commands: string[];
  /** True if the tree had a syntax error (parse was not clean). */
  hasError: boolean;
}

/**
 * Decompose a bash command into its constituent command-node texts.
 * Throws if the tree-sitter parser is unavailable — callers must fail safe.
 */
export async function analyzeBash(command: string): Promise<BashAnalysis> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("tree-sitter failed to parse command");
  try {
    const commands = tree.rootNode
      .descendantsOfType("command")
      .map((n) => n?.text?.trim())
      .filter((t): t is string => Boolean(t));
    return { commands, hasError: tree.rootNode.hasError };
  } finally {
    tree.delete();
  }
}
