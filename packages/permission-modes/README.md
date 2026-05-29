# @pi-ext/permission-modes

Claude-Code-style **permission modes** for the Pi coding agent, toggled with **Shift+Tab**, backed by a merged allow/deny/ask **rule engine**.

Pi has no native permission system — tool calls run unless an extension gates them. This extension adds one, mirroring Claude Code's UX, and reuses your existing Claude permission rules.

## Modes

Cycle with **Shift+Tab** (or `/permissions <mode>`):

| Mode | Indicator | Behavior |
|------|-----------|----------|
| `default` | `● default` | Read-only tools run freely. Mutating tools (`bash`/`edit`/`write`) are checked against the rules; if nothing allows them, you're prompted. |
| `acceptEdits` | `✓ accept edits` | File `edit`/`write` auto-apply. `bash` still goes through the rules (so `git commit` still prompts unless allowlisted). |
| `plan` | `⏸ plan` | All mutating tools are blocked. |
| `bypass` | `⚠ bypass` | Everything runs, no prompts. Only explicit `deny` rules still block. |

The current mode shows in the footer and is restored on resume. Start in a mode with `--permission-mode <mode>`.

## Rule engine

A tool call resolves with precedence **deny > ask > allow**:

- **deny** match → blocked (in every mode, even `bypass`)
- **ask** match → prompt
- **allow** match → runs without prompting
- no match → falls back to the mode's default

Rules use Claude's `Tool(specifier)` syntax — `Bash(git add:*)` (prefix), `Bash(git status)` (exact), `Edit(src/**)` (path glob), or a bare `Read` (whole tool).

Bash commands are parsed with **tree-sitter** (real AST, via `web-tree-sitter` + `tree-sitter-bash`), not string-splitting. Every command node — including those inside pipelines, `&&`/`;` chains, subshells, and **command substitution** `$(...)`/backticks — is checked individually. A command is auto-allowed only if **every** node matches an allow rule (benign no-ops like `cd`/`pwd` are ignored, so `cd <repo> && git status` works); it's denied if **any** node matches a deny rule. This closes substitution bypasses such as `git status $(rm -rf /)` — the inner `rm -rf /` is its own node and is caught.

### Rule sources (all merged)

Claude (read live — your existing rules just work):

1. `~/.claude/settings.json`
2. `<repo>/.claude/settings.json`
3. `<repo>/.claude/settings.local.json`

Pi-native dedicated stores (owned by this extension; Pi never parses them):

4. `~/.pi/agent/permissions.json` — global, read in every repo
5. `<repo>/.pi/permissions.json` — project

Plus the active skill's `allowed-tools` and in-session "allow" choices.

Dedicated stores use a flat shape:

```json
{ "allow": ["Bash(git commit:*)"], "deny": [], "ask": [], "meta": { "importedFromClaude": true } }
```

When you approve a prompt you can choose **once**, **for this session**, or **always** — "always" writes the scoped rule to the **project** store (`<repo>/.pi/permissions.json`), or the **global** store when you're not in a repo.

### Claude import

On first run the extension imports your global Claude rules (`~/.claude/settings.json`) into the global store `~/.pi/agent/permissions.json` (once, marked in `meta`). Re-run with `/permissions import`. Opt out with `/permissions auto-import off` (or set `"meta": { "autoImport": false }` in `~/.pi/agent/permissions.json`).

## Skill `allowed-tools`

When you invoke a skill with `/skill:<name>`, its `allowed-tools` frontmatter is applied as allow rules until your next plain message. This is what makes the **git-review** workflow smooth: that skill allows `Bash(git add:*)`, `Bash(git reset:*)`, `Bash(git status:*)`, `Bash(git-hunk:*)` — but not `Bash(git commit:*)` — so staging runs silently and only `git commit` prompts.

> Limitation: model-invoked skills (not typed `/skill:` by you) don't emit an input event, so their `allowed-tools` aren't detected.

## Install

```bash
pi install /path/to/pi-extensions/packages/permission-modes
# or add the path to ~/.pi/agent/settings.json "packages": [...]
```

### Enabling Shift+Tab (one-time)

Shift+Tab is reserved by Pi for `app.thinking.cycle`, so an extension binding for it is skipped until you free the key. Add to `~/.pi/agent/keybindings.json`:

```json
{ "app.thinking.cycle": "ctrl+shift+t" }
```

Until then, cycle modes with `/permissions` or the fallback chord **Ctrl+Shift+A**.

## Commands & shortcuts

- **Shift+Tab** / **Ctrl+Shift+A** — cycle mode
- `/permissions` — show current mode
- `/permissions default|acceptEdits|plan|bypass` — set mode
- `/permissions import` — import Claude rules into `~/.pi/agent/permissions.json`
- `/permissions auto-import on|off` — toggle automatic Claude import
