import { describe, expect, it } from "vitest";
import { type PermissionMode, MODE_CYCLE, nextMode } from "../src/modes.ts";
import { type RuleSet, decide } from "../src/rules/engine.ts";
import { globToRegExp, matchBash, normalizeSubcommand, splitCompound } from "../src/rules/match.ts";
import { extractPermissions, mergeRuleSets } from "../src/rules/merge.ts";
import { parseRule, parseShellRule } from "../src/rules/parser.ts";
import { bashScopeRule, pathScopeRule } from "../src/scope.ts";
import { parseAllowedTools } from "../src/skills.ts";

const rs = (allow: string[] = [], deny: string[] = [], ask: string[] = []): RuleSet => ({
  allow,
  deny,
  ask,
});

describe("parseRule", () => {
  it("splits Tool(specifier)", () => {
    expect(parseRule("Bash(git add:*)")).toEqual({ toolName: "Bash", ruleContent: "git add:*" });
  });
  it("treats bare tool as tool-wide", () => {
    expect(parseRule("Read")).toEqual({ toolName: "Read" });
  });
  it("treats (*) as tool-wide", () => {
    expect(parseRule("Bash(*)")).toEqual({ toolName: "Bash" });
  });
  it("returns null for blanks", () => {
    expect(parseRule("   ")).toBeNull();
  });
});

describe("parseShellRule", () => {
  it("detects prefix via :* suffix", () => {
    expect(parseShellRule("git add:*")).toEqual({ type: "prefix", prefix: "git add" });
  });
  it("detects exact", () => {
    expect(parseShellRule("git status")).toEqual({ type: "exact", command: "git status" });
  });
  it("detects wildcard", () => {
    expect(parseShellRule("npm run *")).toEqual({ type: "wildcard", pattern: "npm run *" });
  });
});

describe("splitCompound", () => {
  it("splits on && | ; operators", () => {
    expect(splitCompound("git add . && git commit -m x")).toEqual(["git add .", "git commit -m x"]);
    expect(splitCompound("cat a | grep b ; echo c")).toEqual(["cat a", "grep b", "echo c"]);
  });
  it("keeps quoted operators intact", () => {
    expect(splitCompound('git commit -m "a && b"')).toEqual(['git commit -m "a && b"']);
  });
});

describe("normalizeSubcommand", () => {
  it("strips safe wrappers", () => {
    expect(normalizeSubcommand("timeout 5 git status")).toBe("git status");
  });
  it("strips leading env assignments", () => {
    expect(normalizeSubcommand("FOO=bar git commit")).toBe("git commit");
  });
  it("strips output redirections", () => {
    expect(normalizeSubcommand("echo hi > out.txt")).toBe("echo hi");
  });
});

describe("globToRegExp", () => {
  it("matches ** across slashes", () => {
    expect(globToRegExp("src/**").test("src/a/b.ts")).toBe(true);
  });
  it("single * does not cross slashes", () => {
    expect(globToRegExp("src/*").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("src/*").test("src/a.ts")).toBe(true);
  });
});

describe("decide — bash, the git-review case", () => {
  it("auto-allows staging from the skill allowlist", () => {
    expect(decide({ toolName: "bash", command: "git add -A" }, rs(["Bash(git add:*)"]))).toBe(
      "allow",
    );
  });
  it("prompts for git commit (not in allowlist)", () => {
    const ruleset = rs(["Bash(git add:*)", "Bash(git status:*)", "Bash(git-hunk:*)"]);
    expect(
      decide({ toolName: "bash", command: 'git commit -m "feat: x"' }, ruleset),
    ).toBeUndefined();
  });
  it("exact rule matches exact command", () => {
    expect(decide({ toolName: "bash", command: "git status" }, rs(["Bash(git status)"]))).toBe(
      "allow",
    );
  });
});

describe("decide — compound commands", () => {
  it("allows only when every sub-command is allowed", () => {
    const both = rs(["Bash(git add:*)", "Bash(git commit:*)"]);
    expect(decide({ toolName: "bash", command: "git add . && git commit -m x" }, both)).toBe(
      "allow",
    );
  });
  it("does not allow when one sub-command is missing", () => {
    expect(
      decide(
        { toolName: "bash", command: "git add . && git commit -m x" },
        rs(["Bash(git add:*)"]),
      ),
    ).toBeUndefined();
  });
  it("denies if any sub-command matches a deny rule", () => {
    const ruleset = rs(["Bash(git add:*)"], ["Bash(rm:*)"]);
    expect(decide({ toolName: "bash", command: "git add . && rm -rf build" }, ruleset)).toBe(
      "deny",
    );
  });
});

describe("decide — precedence", () => {
  it("deny beats allow", () => {
    expect(decide({ toolName: "bash", command: "rm -rf /" }, rs(["Bash"], ["Bash(rm:*)"]))).toBe(
      "deny",
    );
  });
  it("ask beats allow", () => {
    expect(
      decide({ toolName: "bash", command: "git push" }, rs(["Bash"], [], ["Bash(git push:*)"])),
    ).toBe("ask");
  });
});

describe("decide — edit/write paths", () => {
  it("matches a directory glob", () => {
    expect(decide({ toolName: "edit", path: "/repo/src/a.ts" }, rs(["Edit(/repo/src/**)"]))).toBe(
      "allow",
    );
  });
  it("does not match outside the glob", () => {
    expect(
      decide({ toolName: "edit", path: "/repo/other/a.ts" }, rs(["Edit(/repo/src/**)"])),
    ).toBeUndefined();
  });
  it("bare Write matches any path", () => {
    expect(decide({ toolName: "write", path: "/anywhere/x" }, rs(["Write"]))).toBe("allow");
  });
});

describe("matchBash (decomposed command list)", () => {
  it("bare Bash rule matches everything", () => {
    expect(matchBash(["anything goes"], [{ toolName: "Bash" }], "all")).toBe(true);
  });
  it("skips benign no-op prefixes under all-semantics", () => {
    expect(
      matchBash(
        ["cd /repo", "git status --porcelain"],
        [{ toolName: "Bash", ruleContent: "git status:*" }],
        "all",
      ),
    ).toBe(true);
  });
  it("a lone cd auto-satisfies all-semantics", () => {
    expect(
      matchBash(["cd /repo"], [{ toolName: "Bash", ruleContent: "git status:*" }], "all"),
    ).toBe(true);
  });
  it("under any-semantics a substituted command can match deny", () => {
    expect(
      matchBash(
        ["git status $(rm -rf /)", "rm -rf /"],
        [{ toolName: "Bash", ruleContent: "rm:*" }],
        "any",
      ),
    ).toBe(true);
  });
});

describe("decide with AST-decomposed bashCommands", () => {
  it("auto-allows cd-prefixed staging (the cd && bug)", () => {
    expect(
      decide(
        { toolName: "bash", command: "cd /r && git status", bashCommands: ["cd /r", "git status"] },
        rs(["Bash(git status:*)"]),
      ),
    ).toBe("allow");
  });
  it("does NOT auto-allow when a command substitution is present", () => {
    // tree-sitter surfaces the inner `rm -rf /` as its own command node
    expect(
      decide(
        {
          toolName: "bash",
          command: "git status $(rm -rf /)",
          bashCommands: ["git status $(rm -rf /)", "rm -rf /"],
        },
        rs(["Bash(git status:*)"]),
      ),
    ).toBeUndefined();
  });
  it("denies the substituted command when a deny rule covers it", () => {
    expect(
      decide(
        {
          toolName: "bash",
          command: "git status $(rm -rf /)",
          bashCommands: ["git status $(rm -rf /)", "rm -rf /"],
        },
        rs(["Bash(git status:*)"], ["Bash(rm:*)"]),
      ),
    ).toBe("deny");
  });
});

describe("scope rules", () => {
  it("scopes git commit to the verb", () => {
    expect(bashScopeRule('git commit -m "x"')).toBe("Bash(git commit:*)");
  });
  it("scopes single-word commands to one token", () => {
    expect(bashScopeRule("rm -rf foo")).toBe("Bash(rm:*)");
  });
  it("scopes npm run to two tokens", () => {
    expect(bashScopeRule("npm run test")).toBe("Bash(npm run:*)");
  });
  it("scopes edits to the directory", () => {
    expect(pathScopeRule("edit", "/a/b/c.ts")).toBe("Edit(/a/b/**)");
  });
});

describe("parseAllowedTools", () => {
  it("splits a comma list without breaking parens", () => {
    expect(parseAllowedTools("Bash(git add:*), Read, Bash(git-hunk:*)")).toEqual([
      "Bash(git add:*)",
      "Read",
      "Bash(git-hunk:*)",
    ]);
  });
  it("accepts arrays", () => {
    expect(parseAllowedTools(["Read", "Edit"])).toEqual(["Read", "Edit"]);
  });
});

describe("mode cycle", () => {
  it("cycles default -> acceptEdits -> plan -> bypass -> default", () => {
    const seen: PermissionMode[] = [];
    let m: PermissionMode = "default";
    for (let i = 0; i < MODE_CYCLE.length; i++) {
      seen.push(m);
      m = nextMode(m);
    }
    expect(seen).toEqual(["default", "acceptEdits", "plan", "bypass"]);
    expect(m).toBe("default");
  });
});

describe("extractPermissions", () => {
  it("reads the dedicated top-level shape", () => {
    expect(extractPermissions({ allow: ["Read"], deny: ["Bash(rm:*)"] })).toEqual({
      allow: ["Read"],
      deny: ["Bash(rm:*)"],
      ask: [],
    });
  });
  it("reads the settings-style nested shape", () => {
    expect(
      extractPermissions({ permissions: { allow: ["Edit"], ask: ["Bash(git push:*)"] } }),
    ).toEqual({ allow: ["Edit"], deny: [], ask: ["Bash(git push:*)"] });
  });
  it("handles missing input and non-string entries", () => {
    expect(extractPermissions(undefined)).toEqual({ allow: [], deny: [], ask: [] });
    expect(extractPermissions({ allow: [1, "Read", null] })).toEqual({
      allow: ["Read"],
      deny: [],
      ask: [],
    });
  });
});

describe("mergeRuleSets", () => {
  it("concatenates and dedupes across sources", () => {
    const merged = mergeRuleSets([
      { allow: ["Read", "Edit"], deny: [], ask: [] },
      { allow: ["Edit", "Write"], deny: ["Bash(rm:*)"], ask: [] },
    ]);
    expect(merged.allow).toEqual(["Read", "Edit", "Write"]);
    expect(merged.deny).toEqual(["Bash(rm:*)"]);
    expect(merged.ask).toEqual([]);
  });
});
