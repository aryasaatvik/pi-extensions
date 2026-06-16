# @pi-ext/subagents

A Pi extension that adds Claude-Code-style **sub-agents**: a single `task` tool that
delegates a scoped piece of work to a child agent running **in-process**.

- **Definitions** — markdown files with frontmatter, discovered from `.pi/agents/*.md`
  (project) over `~/.pi/agent/agents/*.md` (global). Built-ins `general-purpose` and
  `explore` work with zero config.
- **Scoped tools** — each agent runs with only its allowed tools (`read`, `bash`,
  `edit`, `write`, `grep`, `find`, `ls`); the `task` tool is never given to children
  (recursion guard).
- **Shared permission gating** — child tool calls are gated by the _same_
  `PermissionController` as the main agent (from `@pi-ext/permission-modes`), so the
  live mode (plan/acceptEdits/bypass) and session grants propagate both ways. Background
  agents fail closed on any rule that would prompt.
- **Background tasks** — `task({ operation: "spawn", background: true })` returns a
  `task_id` immediately and injects the result back into the parent on completion.
  Inspect with `/subagents`.

## The `task` tool

```
task({ operation: "spawn", subagent_type: "explore", description: "find auth flow", prompt: "…" })
task({ operation: "spawn", subagent_type: "general-purpose", prompt: "…", background: true })
task({ operation: "output", task_id: "…" })
task({ operation: "list" })
task({ operation: "cancel", task_id: "…" })   // or { all: true }
```

## Agent definition format

```markdown
---
name: explore
description: Read-only codebase exploration
tools: read, grep, find, ls
model: anthropic/claude-haiku-4-5 # optional; defaults to the parent model
---

You are a focused codebase explorer. …
```

## Config

Global `~/.pi/agent/pi-subagents.json`, project `.pi/pi-subagents.json`. Use
`/subagents` to inspect. Settings: concurrency caps and per-task output cap.
