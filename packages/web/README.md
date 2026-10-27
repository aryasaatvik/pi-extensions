# web

Pi extension providing **`web_search`** and **`web_fetch`** with a pluggable **WebProvider** layer. It supports **Exa** via [`exa-js`](https://github.com/exa-labs/exa-js) and **Parallel** via [`parallel-web`](https://www.npmjs.com/package/parallel-web).

## Requirements

- Pi coding agent 1.4.0 (`@earendil-works/pi-coding-agent`, the workspace `catalog:pi` pin)
- API keys stored in `~/.pi/agent/auth.json` under provider ids `exa` and/or `parallel`

## Install

```bash
pi install /path/to/pi-extensions/packages/web
```

## Tools

| Tool         | Description                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search` | Web search with highlights/excerpts (default 10 results). Supports auto provider routing, `mode` (`fast`, `standard`, `deep`), domain/date filters, Parallel `filters.location`, and Exa categories. |
| `web_fetch`  | Page extraction for known URLs (default 3000 characters per page, at most 20 URLs). Supports focused extraction via `target` and `freshness` (`auto`, `fresh`, `cached`).                            |

Use search to discover URLs; use fetch when highlights are not enough.

### Query tips (search)

- Describe the ideal page, not keywords: `blog post comparing React and Vue performance` not `React vs Vue`.
- Optional Exa category filter: `category:people`, `category:company`, `category:news`, `category:research paper`, `category:personal site`, or the structured `filters.category` input.
- Use `searchQueries` when you want Parallel-style keyword queries alongside the natural-language `query` objective.

## Configuration

Credentials are read from `~/.pi/agent/auth.json`. `/web` (and `/web status`) shows the resolved provider, auth, and caps. `/web config` (alias `/web settings`) edits them. `/web help` lists the commands.

Credential shape:

```json
{
  "exa": {
    "type": "api_key",
    "key": "..."
  },
  "parallel": {
    "type": "api_key",
    "key": "..."
  }
}
```

Defaults:

- `provider: "auto"`
- search: 10 results, max 20; `mode` defaults to `standard`
- fetch: 3000 characters per page, max 20000, at most 20 URLs (`caps.maxFetchUrls`)
- `freshness` defaults to `auto`. Exa sends `fresh` as `maxAgeHours: 0`. Parallel sends `fresh` and `cached` as a fetch policy. `auto` leaves the provider default.
- Exa search: `fast` forces type `fast`; `deep` uses `deep-lite` when `caps.allowDeepSearch` is on (the default); otherwise the configured type (`auto` by default)
- Parallel search: `advanced` by default, `basic` for `mode: "fast"`. `filters.location` is sent only to Parallel. Parallel uses `startPublishedDate` as `after_date` and does not send `endPublishedDate`.

Settings files:

- Global: `~/.pi/agent/pi-web.json`
- Project override: `.pi/pi-web.json`

## Development

```bash
cd packages/web
bun run check
```
