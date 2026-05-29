/**
 * Parser for Claude-Code permission rule strings of the form `Tool(specifier)`.
 *
 * Examples:
 *   "Bash(git add:*)"   -> { toolName: "Bash", ruleContent: "git add:*" }
 *   "Bash(git status)"  -> { toolName: "Bash", ruleContent: "git status" }
 *   "Read"              -> { toolName: "Read", ruleContent: undefined }  (tool-wide)
 *   "Edit(src/**)"      -> { toolName: "Edit", ruleContent: "src/**" }
 *
 * Ported from claude-code's permissionRuleParser + shellRuleMatching.
 */

export interface PermissionRuleValue {
  toolName: string;
  /** undefined or "*" means the rule applies to the whole tool. */
  ruleContent?: string;
}

function findFirstUnescaped(s: string, ch: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === ch) return i;
  }
  return -1;
}

function findLastUnescaped(s: string, ch: string): number {
  let found = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === ch) found = i;
  }
  return found;
}

function unescape(s: string): string {
  return s.replace(/\\([()\\])/g, "$1");
}

/** Parse a single rule string. Returns null for blank input. */
export function parseRule(raw: string): PermissionRuleValue | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const open = findFirstUnescaped(trimmed, "(");
  const close = findLastUnescaped(trimmed, ")");

  if (open === -1 || close === -1 || close < open) {
    return { toolName: trimmed };
  }

  const toolName = trimmed.slice(0, open).trim();
  const content = unescape(trimmed.slice(open + 1, close)).trim();
  if (!content || content === "*") {
    return { toolName };
  }
  return { toolName, ruleContent: content };
}

export type ShellRule =
  | { type: "exact"; command: string }
  | { type: "prefix"; prefix: string }
  | { type: "wildcard"; pattern: string };

function hasUnescapedStar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "*") return true;
  }
  return false;
}

/**
 * Classify a Bash rule's content into exact / prefix / wildcard.
 *   "git add:*"  -> prefix "git add"   (legacy `:*` suffix)
 *   "git status" -> exact "git status"
 *   "npm run *"  -> wildcard
 */
export function parseShellRule(content: string): ShellRule {
  if (content.endsWith(":*")) {
    return { type: "prefix", prefix: content.slice(0, -2).trim() };
  }
  if (hasUnescapedStar(content)) {
    return { type: "wildcard", pattern: content };
  }
  return { type: "exact", command: content };
}
